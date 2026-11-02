import { expect, test } from '@playwright/test'

// Browser tests for the characteristics section and the career list.
test.describe('characteristics', () => {
  // Loads ?seed=portfolio, records the UPP, reloads, and expects the same six-digit hex UPP.
  test('the same seed always produces the same character', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const first = await page.getByTestId('upp').textContent()
    await page.reload()
    await expect(page.getByTestId('upp')).toHaveText(first ?? '')
    await expect(page.getByTestId('upp')).toHaveText(/^[0-9A-F]{6}$/)
  })

  // Loads ?seed=portfolio, clicks Reroll, and expects the URL to hold a different seed.
  test('reroll changes the seed in the URL', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Reroll' }).click()
    await expect(page).not.toHaveURL(/seed=portfolio/)
    await expect(page).toHaveURL(/seed=\w+/)
  })

  // Types 15 into the STR input and expects DM +3, the row marked overridden, and a UPP starting with F.
  test('a player can override a rolled value', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const strInput = page.getByLabel('STR value')
    await strInput.fill('15')
    await expect(page.getByTestId('dm-STR')).toHaveText('+3')
    await expect(page.getByTestId('char-STR')).toHaveClass(/overridden/)
    await expect(page.getByTestId('upp')).toHaveText(/^F/)
  })

  // Loads the page and expects the career list to contain at least one item.
  test('career data files are listed', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await expect(page.getByTestId('career-list').getByRole('listitem')).not.toHaveCount(0)
  })
})
