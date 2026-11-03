import { expect, test } from '@playwright/test'

// Starting page for the Playwright planner and generator agents.
test.describe('Test group', () => {
  // Opens the app with ?seed=agent-seed and expects the page heading to be visible.
  test('seed', async ({ page }) => {
    await page.goto('./?seed=agent-seed')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
