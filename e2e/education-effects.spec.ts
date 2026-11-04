import { expect, test } from '@playwright/test'

// Browser tests for the next-career effect (docs/features/education.md), with the invented
// e2e/fixtures/next-career-pack.json and ?seed=terms.
test.describe('next-career effect', () => {
  // Imports the pack, starts the Sending career, plays term 1 with the roll 8 event (next career: Receiving
  // career), musters out with a benefit roll, and expects career 2 to be the Receiving career with a
  // qualification step that is not rolled and the notice that an event sent the character there.
  // Criteria: ED-20.
  test('an event sends the character to the next career', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/next-career-pack.json')
    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Sending career' })
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByLabel('Term 1 Survival dice').fill('12')
    await page.getByLabel('Term 1 Event dice').fill('8')
    await page.getByLabel('Term 1 Advancement dice').fill('2')
    await expect(page.getByTestId('step-term-1.event')).toContainText('Receiving career next term')

    await page.getByRole('button', { name: 'Muster out' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    const second = page.getByTestId('career-run-2')
    await expect(second.getByTestId('career-name')).toContainText('Receiving career')
    await expect(second.getByTestId('career-entry')).toHaveText('An event sent the character to Receiving career.')
    await expect(page.getByTestId('step-career-2.qualification')).toContainText('No qualification roll: an event sent the character to Receiving career.')
  })
})
