import { expect, test, type Page } from '@playwright/test'

/** Opens ./?seed=terms, starts the sample career, picks Service skills, and plays term 1 with `event`. */
async function term1(page: Page, event: number): Promise<void> {
  await page.goto('./?seed=terms')
  await page.getByRole('button', { name: 'Start career' }).click()
  await page.getByRole('button', { name: 'Service skills' }).click()
  await page.getByLabel('Term 1 Survival dice').fill('12')
  await page.getByLabel('Term 1 Event dice').fill(String(event))
  await page.getByLabel('Term 1 Advancement dice').fill('2')
}

/** Clicks Leave career and takes Cash for the one benefit roll, so the finished summary shows. */
async function leaveWithCash(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Leave career' }).click()
  await page.getByRole('button', { name: 'Cash' }).click()
  await expect(page.getByTestId('career-summary')).toBeVisible()
}

// Browser tests for Life Events with no career pack loaded (docs/features/life-events.md).
test.describe('life events', () => {
  // Plays term 1 of the sample career with the roll 7 event, and expects a Life Event step right after the
  // event step with the sample rules' entry and two ship shares applied.
  // Criteria: LE-1, LE-7.
  test('the sample career roll 7 event rolls a Life Event inline', async ({ page }) => {
    await term1(page, 7)
    const life = page.getByTestId('step-term-1.event.effect-0.life-event')
    await expect(life).toContainText('Life Event')
    await expect(life).toContainText('Passes Go! Collects two ship shares.')
    await expect(life).toContainText('Applied: 2 ship shares')
    const keys = await page.getByTestId('term-1').locator('li[data-testid^="step-term-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')),
    )
    expect(keys.indexOf('step-term-1.event.effect-0.life-event')).toBe(keys.indexOf('step-term-1.event') + 1)
  })

  // Plays term 1 with the roll 7 event, leaves with cash, and expects "ship shares 2" in the finished
  // summary; then plays term 1 with the roll 9 event instead and expects no ship shares shown.
  // Criteria: LE-8.
  test('the finished summary shows ship shares only when there are some', async ({ page }) => {
    await term1(page, 7)
    await leaveWithCash(page)
    await expect(page.getByTestId('summary-ship-shares')).toHaveText('2')
    await page.evaluate(() => localStorage.clear())
    await term1(page, 9)
    await leaveWithCash(page)
    await expect(page.getByTestId('summary-ship-shares')).toHaveCount(0)
  })
})
