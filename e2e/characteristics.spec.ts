import { expect, test } from '@playwright/test'

// Browser tests for the seed, the characteristics table and its overrides.
test.describe('characteristics', () => {
  // Loads ?seed=portfolio, records the UPP, reloads, and expects the same non-empty six-digit UPP.
  test('the same seed always produces the same character', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const upp = page.getByTestId('upp')
    await expect(upp).toHaveText(/^[0-9A-HJ-NP-Z]{6}$/)
    const first = await upp.textContent()
    await page.reload()
    await expect(upp).toHaveText(first ?? 'missing UPP')
  })

  // Loads the page with no seed and expects a seed to be written to the URL and match the one shown.
  test('a page without a seed writes its random seed to the URL', async ({ page }) => {
    await page.goto('./')
    await expect(page).toHaveURL(/[?&]seed=[0-9a-z]{8}(&|$)/)
    const seed = new URL(page.url()).searchParams.get('seed')
    await expect(page.getByTestId('seed')).toHaveText(seed ?? 'missing seed')
  })

  // Loads ?seed= with an empty value and expects a random seed to replace it in the URL and on the page.
  test('an empty seed is replaced with a random one', async ({ page }) => {
    await page.goto('./?seed=')
    await expect(page).toHaveURL(/[?&]seed=[0-9a-z]{8}(&|$)/)
    await expect(page.getByTestId('seed')).toHaveText(/^[0-9a-z]{8}$/)
  })

  // Loads ?seed=portfolio, clicks Reroll, and expects a new seed in the URL that matches the one shown.
  test('reroll changes the seed in the URL and on the page', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Reroll' }).click()
    await expect(page).not.toHaveURL(/seed=portfolio/)
    await expect(page).toHaveURL(/[?&]seed=[0-9a-z]{8}(&|$)/)
    const seed = new URL(page.url()).searchParams.get('seed')
    await expect(page.getByTestId('seed')).toHaveText(seed ?? 'missing seed')
  })

  // Clears the STR field with the keyboard, types 12 one key at a time, and expects the field to show
  // 12, DM +2, the Overridden badge, and a UPP starting with C.
  test('a player can clear a value and type a new one', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const str = page.getByLabel('STR value')
    await str.click()
    await str.press('ControlOrMeta+a')
    await str.press('Backspace')
    await expect(str).toHaveValue('')
    await str.pressSequentially('12')
    await expect(str).toHaveValue('12')
    await expect(page.getByTestId('dm-STR')).toHaveText('+2')
    await expect(page.getByTestId('overridden-STR')).toHaveText('Overridden')
    await expect(page.getByTestId('upp')).toHaveText(/^C/)
  })

  // Overrides STR, clicks Reset, and expects the field to show the rolled value with no badge.
  test('reset returns a value to the roll', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const row = page.getByTestId('char-STR')
    const rolled = await row.getByRole('cell').first().textContent()
    const str = page.getByLabel('STR value')
    await str.fill(rolled === '12' ? '11' : '12')
    await page.getByRole('button', { name: 'Reset STR to rolled value' }).click()
    await expect(str).toHaveValue(rolled ?? 'missing rolled value')
    await expect(page.getByTestId('overridden-STR')).toHaveCount(0)
  })

  // Types 99 into STR, leaves the field, and expects it to be clamped to 33 with a UPP starting with Z.
  test('out-of-range values are clamped when the field loses focus', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const str = page.getByLabel('STR value')
    await str.fill('99')
    await str.blur()
    await expect(str).toHaveValue('33')
    await expect(page.getByTestId('upp')).toHaveText(/^Z/)
  })

  // Clears STR, leaves the field empty, and expects it to return to the value it had before.
  test('an empty field returns to its value when it loses focus', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const str = page.getByLabel('STR value')
    const before = await str.inputValue()
    await str.fill('')
    await str.blur()
    await expect(str).toHaveValue(before)
  })
})

// Browser tests for the career list and the page layout.
test.describe('page', () => {
  // Loads the page and expects the career list to contain at least one item and no error panel.
  test('career data files are listed without errors', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await expect(page.getByTestId('career-list').getByRole('listitem')).not.toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  // Sets a 320px-wide viewport, overrides STR so the badge and Reset button show, and expects neither
  // the page nor the characteristics table to scroll sideways.
  test('the page does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('./?seed=portfolio')
    await page.getByLabel('STR value').fill('2')
    await page.getByLabel('STR value').blur()
    const overflow = await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap')
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        table: wrap ? wrap.scrollWidth - wrap.clientWidth : Number.NaN,
      }
    })
    expect(overflow).toEqual({ page: 0, table: 0 })
  })
})
