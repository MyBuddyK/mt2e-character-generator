import { expect, test } from '@playwright/test'

// Starting point for the Playwright planner and generator agents. It opens the
// app with a fixed seed so every agent session sees the same character.
test.describe('Test group', () => {
  test('seed', async ({ page }) => {
    await page.goto('./?seed=agent-seed')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
