import { expect, test } from '@playwright/test'

test.describe('characteristics', () => {
  test('the same seed always produces the same character', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const first = await page.getByTestId('upp').textContent()
    await page.reload()
    await expect(page.getByTestId('upp')).toHaveText(first ?? '')
    await expect(page.getByTestId('upp')).toHaveText(/^[0-9A-F]{6}$/)
  })

  test('reroll changes the seed in the URL', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    await page.getByRole('button', { name: 'Reroll' }).click()
    await expect(page).not.toHaveURL(/seed=portfolio/)
    await expect(page).toHaveURL(/seed=\w+/)
  })

  test('a player can override a rolled value', async ({ page }) => {
    await page.goto('./?seed=portfolio')
    const strInput = page.getByLabel('STR value')
    await strInput.fill('15')
    await expect(page.getByTestId('dm-STR')).toHaveText('+3')
    await expect(page.getByTestId('char-STR')).toHaveClass(/overridden/)
    await expect(page.getByTestId('upp')).toHaveText(/^F/)
  })

  test('career data files are listed', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('career-list').getByRole('listitem')).not.toHaveCount(0)
  })
})
