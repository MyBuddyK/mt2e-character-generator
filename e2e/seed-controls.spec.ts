import { expect, test } from '@playwright/test'

// Browser tests for the seed shown in the page header and its Copy seed and Clear seed buttons.
test.describe('seed controls', () => {
  // Loads ?seed=portfolio and expects the header to show "portfolio", the same value as ?seed= in the URL.
  // Criteria: SC-1.
  test('the header shows the seed from the URL', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await expect(page.locator('header').getByTestId('seed')).toHaveText('portfolio')
    expect(new URL(page.url()).searchParams.get('seed')).toBe('portfolio')
  })

  // Grants clipboard access, loads ?seed=portfolio, clicks Copy seed, and expects "Seed copied." to be shown
  // and the clipboard to hold "portfolio".
  // Criteria: SC-2.
  test('copy seed writes the seed to the clipboard and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Copy seed' }).click()
    await expect(page.getByTestId('seed-status')).toHaveText('Seed copied.')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('portfolio')
  })

  // Makes navigator.clipboard.writeText reject before the page loads, clicks Copy seed, and expects the
  // message asking the player to copy the seed by hand.
  // Criteria: SC-3.
  test('copy seed shows a message when the clipboard write is refused', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: () => Promise.reject(new DOMException('Write refused', 'NotAllowedError')),
      })
    })
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Copy seed' }).click()
    await expect(page.getByTestId('seed-status')).toHaveText("Couldn't copy the seed. Select it and copy it by hand.")
  })

  // Loads ?seed=portfolio, overrides STR, clicks Clear seed, and expects a new eight-character seed in the
  // URL that matches the header, and no Overridden badge on STR.
  // Criteria: SC-4.
  test('clear seed replaces the seed and drops overrides', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await page.getByLabel('STR value').fill('12')
    await expect(page.getByTestId('overridden-STR')).toBeVisible()
    await page.getByRole('button', { name: 'Clear seed' }).click()
    await expect(page).not.toHaveURL(/seed=portfolio/)
    await expect(page).toHaveURL(/[?&]seed=[0-9a-z]{8}(&|$)/)
    const seed = new URL(page.url()).searchParams.get('seed')
    await expect(page.getByTestId('seed')).toHaveText(seed ?? 'missing seed')
    await expect(page.getByTestId('overridden-STR')).toHaveCount(0)
  })

  // Grants clipboard access, copies the seed, clicks Clear seed, and expects the "Seed copied." message to
  // be gone.
  // Criteria: SC-5.
  test('clear seed removes the copy message for the old seed', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Copy seed' }).click()
    await expect(page.getByTestId('seed-status')).toHaveText('Seed copied.')
    await page.getByRole('button', { name: 'Clear seed' }).click()
    await expect(page.getByTestId('seed')).not.toHaveText('portfolio')
    // Read once instead of retrying, because the 4-second timer would empty the message on its own.
    expect(await page.getByTestId('seed-status').textContent()).toBe('')
  })

  // Loads ?seed=terms, starts a career, clicks Clear seed, opens ?seed=terms again, and expects the first
  // term's survival step to be shown.
  // Criteria: SC-6.
  test('clear seed keeps the career saved for the old seed', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await expect(page.getByTestId('step-term-1.survival')).toBeVisible()
    await page.getByRole('button', { name: 'Clear seed' }).click()
    await expect(page.getByTestId('step-term-1.survival')).toHaveCount(0)
    await page.goto('./?seed=terms')
    await expect(page.getByTestId('step-term-1.survival')).toBeVisible()
  })

  // Removes navigator.clipboard before the page loads, clicks Copy seed, and expects the message asking the
  // player to copy the seed by hand.
  // Criteria: SC-7.
  test('copy seed shows a message when the page has no Clipboard API', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true })
    })
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Copy seed' }).click()
    await expect(page.getByTestId('seed-status')).toHaveText("Couldn't copy the seed. Select it and copy it by hand.")
  })

  // Makes navigator.clipboard.writeText resolve after 1 second and then mark the html element with
  // data-copy-done 100 ms later. Clicks Copy seed, then Clear seed before the write resolves, waits for the
  // mark, and expects no copy message next to the new seed.
  // Criteria: SC-8.
  test('clear seed during a copy shows no copy message for the new seed', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve()
              setTimeout(() => {
                document.documentElement.dataset['copyDone'] = 'yes'
              }, 100)
            }, 1000)
          }),
      })
    })
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Copy seed' }).click()
    await page.getByRole('button', { name: 'Clear seed' }).click()
    await expect(page.getByTestId('seed')).not.toHaveText('portfolio')
    await expect(page.locator('html')).toHaveAttribute('data-copy-done', 'yes')
    // Read once instead of retrying, because the 4-second timer would empty the message on its own.
    expect(await page.getByTestId('seed-status').textContent()).toBe('')
  })

  // Installs Playwright's fake clock, grants clipboard access, clicks Copy seed, expects "Seed copied.",
  // moves the clock forward 4 seconds, and expects the message to be gone.
  // Criteria: SC-9.
  test('the copy message is removed after 4 seconds', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.clock.install()
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Copy seed' }).click()
    await expect(page.getByTestId('seed-status')).toHaveText('Seed copied.')
    await page.clock.fastForward(4000)
    await expect(page.getByTestId('seed-status')).toBeEmpty()
  })

  // Loads ?seed=portfolio and expects the seed element to be inside an element with aria-live="polite".
  // Criteria: SC-10.
  test('the seed is inside a polite live region', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await expect(page.locator('[aria-live="polite"]').getByTestId('seed')).toHaveText('portfolio')
  })
})
