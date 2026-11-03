import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Route } from '@playwright/test'

const FIXTURES = 'e2e/fixtures'
const PACK_URL = 'https://packs.test/valid-pack.json'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

/** Returns the parsed JSON of an e2e fixture file. */
function fixture(name: string): Record<string, unknown> {
  const data: unknown = JSON.parse(readFileSync(`${FIXTURES}/${name}`, 'utf8'))
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(`${name} is not an object`)
  return { ...data }
}

/** Picks the fixture file `name` with the Import from file control. */
async function importFixture(page: Page, name: string): Promise<void> {
  await page.getByLabel('Import from file').setInputFiles(`${FIXTURES}/${name}`)
}

/** Picks a file called `name` holding `data` as JSON with the Import from file control. */
async function importData(page: Page, name: string, data: unknown): Promise<void> {
  await page.getByLabel('Import from file').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })
}

/** Returns the career list items' text. */
function careerList(page: Page) {
  return page.getByTestId('career-list').getByRole('listitem')
}

/** Fulfills `route` with `data` as a JSON body that any origin may read. */
function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(data) })
}

/** Types `url` into the Pack URL field and clicks Load from URL. */
async function loadUrl(page: Page, url: string): Promise<void> {
  await page.getByLabel('Pack URL').fill(url)
  await page.getByRole('button', { name: 'Load from URL' }).click()
}

// Browser tests for importing, saving, replacing and removing career packs from files.
test.describe('career packs from files', () => {
  // Loads the page with nothing imported and expects the no-packs line and the sample career.
  test('with nothing imported, the sample career is listed', async ({ page }) => {
    await page.goto('./?seed=packs')
    await expect(page.getByTestId('no-packs')).toBeVisible()
    await expect(careerList(page)).toHaveCount(1)
    await expect(careerList(page).first()).toContainText('Sample: Orbital Sanitation')
  })

  // Imports valid-pack.json and expects its row (name, revision, fingerprint, 2 careers, file), its
  // careers in the list without the sample, and the pack in the ?packs= link value.
  test('importing a valid pack lists it and its careers and hides the sample', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'valid-pack.json')
    const row = page.getByTestId('pack-test-core')
    await expect(row).toContainText('Test core pack')
    await expect(row).toContainText('rev 1')
    await expect(row).toContainText('2 careers')
    await expect(row.getByTestId('pack-origin')).toHaveText('file')
    await expect(row.getByTestId('pack-fingerprint')).toHaveText(/^[0-9a-f]{8}$/)
    await expect(careerList(page)).toHaveText([/Test Courier/, /Test Surveyor/])
    const fingerprint = await row.getByTestId('pack-fingerprint').textContent()
    await expect(page).toHaveURL(new RegExp(`[?&]packs=test-core%40${fingerprint ?? 'missing'}`))
  })

  // Imports valid-pack.json, reloads, and expects the pack still listed; then removes it, reloads,
  // and expects the sample career back.
  test('an imported pack is kept after a reload until it is removed', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'valid-pack.json')
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    await page.getByRole('button', { name: 'Remove Test core pack' }).click()
    await expect(careerList(page)).toHaveText([/Sample: Orbital Sanitation/])
    await page.reload()
    await expect(page.getByTestId('no-packs')).toBeVisible()
    await expect(careerList(page)).toHaveText([/Sample: Orbital Sanitation/])
  })

  // Imports a file that is not JSON and expects an alert naming the file, and no pack after a reload.
  test('a file that is not JSON shows an alert and is not saved', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'not-json.json')
    await expect(page.getByRole('alert')).toContainText('not-json.json: the file is not valid JSON.')
    await page.reload()
    await expect(page.getByTestId('no-packs')).toBeVisible()
  })

  // Imports a pack with formatVersion 2 and expects an alert saying the app supports version 1.
  test('a later format version shows an alert naming the supported version', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'later-version-pack.json')
    await expect(page.getByRole('alert')).toContainText('this app supports version 1')
    await expect(page.getByTestId('no-packs')).toBeVisible()
  })

  // Imports a file whose format field is wrong and expects an alert naming the expected format.
  test('a file with the wrong format shows an alert', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'wrong-format.json')
    await expect(page.getByRole('alert')).toContainText('"format" must be "mt2e-career-pack"')
  })

  // Imports a pack whose second career is invalid and expects the first career loaded and the second
  // listed by index and field under the pack row.
  test('a pack with one invalid career loads the others and lists the invalid one', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'partly-invalid-pack.json')
    const row = page.getByTestId('pack-test-partial')
    await expect(row).toContainText('1 career')
    await expect(careerList(page)).toHaveText([/Test Courier/])
    await row.getByText('some careers were skipped').click()
    await expect(row).toContainText('careers.1 (test-surveyor): qualification.target:')
  })

  // Imports valid-pack.json, then a revision 2 copy with the same id, dismisses the confirmation
  // (which shows both revisions), and expects revision 1 kept; then accepts it and expects revision 2.
  test('importing a pack with a loaded id asks first and shows both revisions', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'valid-pack.json')
    const row = page.getByTestId('pack-test-core')
    await expect(row).toContainText('rev 1')
    const revised = { ...fixture('valid-pack.json'), revision: 2 }

    const dismissed = page.waitForEvent('dialog').then(async (dialog) => {
      const message = dialog.message()
      await dialog.dismiss()
      return message
    })
    await importData(page, 'valid-pack-rev2.json', revised)
    const message = await dismissed
    expect(message).toContain('Loaded: revision 1')
    expect(message).toContain('New: revision 2')
    await expect(page.getByRole('status')).toContainText('Kept the loaded copy')
    await expect(row).toContainText('rev 1')

    page.once('dialog', (dialog) => void dialog.accept())
    await importData(page, 'valid-pack-rev2.json', revised)
    await expect(row).toContainText('rev 2')
  })

  // Imports two packs that both define test-courier, in both orders, and expects the career from
  // test-another (the id that sorts first) each time, with the duplicate notice shown.
  test('a career id in two packs is taken from the pack whose id sorts first', async ({ page }) => {
    await page.goto('./?seed=packs')
    for (const order of [
      ['valid-pack.json', 'overlap-pack.json'],
      ['overlap-pack.json', 'valid-pack.json'],
    ]) {
      for (const name of order) await importFixture(page, name)
      await expect(page.getByTestId('pack-list').getByRole('listitem')).toHaveCount(2)
      await expect(careerList(page)).toHaveText([/Test Courier \(other pack\)/, /Test Surveyor/])
      await expect(page.getByTestId('duplicate-careers')).toContainText('career id "test-courier"')
      await page.getByRole('button', { name: 'Remove Test core pack' }).click()
      await page.getByRole('button', { name: 'Remove Test another pack' }).click()
      await expect(page.getByTestId('no-packs')).toBeVisible()
    }
  })

  // Sets a 320px-wide viewport, imports valid-pack.json, and expects the page not to scroll sideways.
  test('the Career data section with a pack loaded fits at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('./?seed=packs')
    await importFixture(page, 'valid-pack.json')
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })

  // Imports a pack whose career reuses the sample's id and expects that career listed.
  test('a pack career may reuse the sample career id', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'sample-id-pack.json')
    await expect(careerList(page)).toHaveText([/Test Sanitation Rewrite/])
  })

  // Moves focus to the Import from file control with Tab, presses Space, picks valid-pack.json in the
  // file chooser, and expects the pack to load.
  test('the import control works from the keyboard', async ({ page }) => {
    await page.goto('./?seed=packs')
    const input = page.getByLabel('Import from file')
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab')
      if (await input.evaluate((el) => el === document.activeElement)) break
    }
    await expect(input).toBeFocused()
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Space')
    await (await chooser).setFiles(`${FIXTURES}/valid-pack.json`)
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
  })
})

// Browser tests for how the app handles blocked or full browser storage.
test.describe('career pack storage', () => {
  // Makes window.localStorage throw, imports valid-pack.json, and expects the pack loaded with the
  // storage notice shown.
  test('with storage blocked, an import loads for the visit and the notice is shown', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError')
        },
      })
    })
    await page.goto('./?seed=packs')
    await expect(page.getByTestId('storage-notice')).toBeVisible()
    await importFixture(page, 'valid-pack.json')
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
  })

  // Imports valid-pack.json, then makes writes to the pack key throw QuotaExceededError and imports
  // overlap-pack.json. Expects the not-saved notice naming the second pack, and after a reload only
  // the first pack.
  test('when a save fails, earlier packs stay saved and the notice names the new pack', async ({ page }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'mt2e.careerPacks.v1' && document.documentElement.dataset['failPackWrites'] === 'yes') {
          throw new DOMException('full', 'QuotaExceededError')
        }
        setItem.call(this, key, value)
      }
    })
    await page.goto('./?seed=packs')
    await importFixture(page, 'valid-pack.json')
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    await page.evaluate(() => {
      document.documentElement.dataset['failPackWrites'] = 'yes'
    })
    await importFixture(page, 'overlap-pack.json')
    await expect(page.getByTestId('unsaved-notice')).toContainText('"Test another pack"')
    await page.reload()
    await expect(page.getByTestId('pack-list').getByRole('listitem')).toHaveCount(1)
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
  })
})

// Browser tests for loading packs from https links, with every request served by page.route.
test.describe('career packs from URLs', () => {
  // Serves valid-pack.json at https://packs.test, loads it, and expects its careers and the URL origin.
  test('loading a pack from a URL adds its careers and shows URL as the origin', async ({ page }) => {
    await page.route(PACK_URL, (route) => fulfillJson(route, fixture('valid-pack.json')))
    await page.goto('./?seed=packs')
    await loadUrl(page, PACK_URL)
    const row = page.getByTestId('pack-test-core')
    await expect(row.getByTestId('pack-origin')).toHaveText('URL')
    await expect(careerList(page)).toHaveText([/Test Courier/, /Test Surveyor/])
  })

  // Serves status 404 at the pack URL and expects an alert that includes the status.
  test('a URL that answers 404 shows the status', async ({ page }) => {
    await page.route(PACK_URL, (route) => route.fulfill({ status: 404, headers: CORS, body: 'missing' }))
    await page.goto('./?seed=packs')
    await loadUrl(page, PACK_URL)
    await expect(page.getByRole('alert')).toContainText('HTTP status 404')
  })

  // Aborts the request to the pack URL and expects the blocked-or-unreachable alert.
  test('a URL whose request fails shows the blocked or unreachable alert', async ({ page }) => {
    await page.route(PACK_URL, (route) => route.abort('failed'))
    await page.goto('./?seed=packs')
    await loadUrl(page, PACK_URL)
    await expect(page.getByRole('alert')).toContainText('the request was blocked or the host could not be reached')
  })

  // Enters an http:// link and expects the https-only alert, with no request made to that host.
  test('an http:// link is refused without a request', async ({ page }) => {
    let requests = 0
    await page.route('http://packs.test/**', (route) => {
      requests += 1
      return route.abort()
    })
    await page.goto('./?seed=packs')
    await loadUrl(page, 'http://packs.test/valid-pack.json')
    await expect(page.getByRole('alert')).toContainText('only https:// links are accepted')
    expect(requests).toBe(0)
  })

  // Loads revision 1 from the URL, switches the route to revision 2, clicks Check for update, and
  // expects a confirmation with both revisions; accepting it shows rev 2.
  test('check for update offers a higher revision and shows both revisions', async ({ page }) => {
    let served = fixture('valid-pack.json')
    await page.route(PACK_URL, (route) => fulfillJson(route, served))
    await page.goto('./?seed=packs')
    await loadUrl(page, PACK_URL)
    const row = page.getByTestId('pack-test-core')
    await expect(row).toContainText('rev 1')

    served = { ...served, revision: 2 }
    const accepted = page.waitForEvent('dialog').then(async (dialog) => {
      const message = dialog.message()
      await dialog.accept()
      return message
    })
    await page.getByRole('button', { name: 'Check Test core pack for update' }).click()
    const message = await accepted
    expect(message).toContain('Loaded: revision 1')
    expect(message).toContain('New: revision 2')
    await expect(row).toContainText('rev 2')
  })

  // Loads the pack from the URL, changes its name without raising the revision, clicks Check for
  // update, and expects the confirmation to say the revision was not raised.
  test('check for update notices changed content with the same revision', async ({ page }) => {
    let served = fixture('valid-pack.json')
    await page.route(PACK_URL, (route) => fulfillJson(route, served))
    await page.goto('./?seed=packs')
    await loadUrl(page, PACK_URL)
    await expect(page.getByTestId('pack-test-core')).toBeVisible()

    served = { ...served, name: 'Test core pack, edited' }
    const dismissed = page.waitForEvent('dialog').then(async (dialog) => {
      const message = dialog.message()
      await dialog.dismiss()
      return message
    })
    await page.getByRole('button', { name: 'Check Test core pack for update' }).click()
    expect(await dismissed).toContain('the revision was not raised')
  })

  // Loads the pack from the URL and clicks Check for update with the same content, and expects a
  // status saying nothing changed and no confirmation.
  test('check for update with unchanged content reports no change', async ({ page }) => {
    await page.route(PACK_URL, (route) => fulfillJson(route, fixture('valid-pack.json')))
    let dialogs = 0
    page.on('dialog', (dialog) => {
      dialogs += 1
      void dialog.dismiss()
    })
    await page.goto('./?seed=packs')
    await loadUrl(page, PACK_URL)
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    await page.getByRole('button', { name: 'Check Test core pack for update' }).click()
    await expect(page.getByRole('status')).toContainText('"Test core pack" has not changed.')
    expect(dialogs).toBe(0)
  })
})

// Browser tests for the ?packs= value in shared links.
test.describe('shared links with packs', () => {
  // Opens a link whose ?packs= names a pack that isn't loaded and expects the mismatch notice listing
  // it; then clicks Reroll and expects a new seed.
  test('a link made with other packs shows a notice and rolling still works', async ({ page }) => {
    await page.goto('./?seed=packs&packs=other-pack%4012345678')
    const notice = page.getByTestId('pack-mismatch')
    await expect(notice).toContainText('other-pack@12345678')
    await expect(notice).toContainText('Loaded: none')
    await page.getByRole('button', { name: 'Reroll' }).click()
    await expect(page.getByTestId('seed')).not.toHaveText('packs')
  })

  // Imports valid-pack.json, opens a link with the matching ?packs= value, and expects no mismatch notice.
  test('a link made with the loaded packs shows no notice', async ({ page }) => {
    await page.goto('./?seed=packs')
    await importFixture(page, 'valid-pack.json')
    await expect(page).toHaveURL(/[?&]packs=/)
    await page.goto(page.url())
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    await expect(page.getByTestId('pack-mismatch')).toHaveCount(0)
  })
})
