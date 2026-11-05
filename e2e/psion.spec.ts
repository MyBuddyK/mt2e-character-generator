import { expect, test } from '@playwright/test'

// Browser tests for PSI and talents (docs/features/prisoner-psion.md), with the invented
// e2e/fixtures/psion-pack.json and ?seed=terms.
test.describe('PSI and talents', () => {
  // Imports the pack and expects the Mind career not listed; plays the Testing career's roll 8 event with PSI
  // dice of 9, leaves with a benefit roll, and expects PSI 9 in the summary and the Mind career listed. Starts
  // it with qualification dice of 12 and expects the talent pick with all three talents and Finish career.
  // Criteria: PP-15, PP-21.
  test('a PSI test opens the Mind career and shows PSI in the summary', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/psion-pack.json')
    const pick = page.getByRole('combobox', { name: 'Career', exact: true })
    await expect(pick.locator('option', { hasText: 'Mind career' })).toHaveCount(0)
    await pick.selectOption({ label: 'Testing career' })
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByLabel('Term 1 Survival dice').fill('12')
    await page.getByLabel('Term 1 Event dice').fill('8')
    await page.getByLabel('Term 1 PSI test dice').fill('9')
    await page.getByLabel('Term 1 Advancement dice').fill('2')
    await page.getByRole('button', { name: 'Leave career' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('summary-psi')).toHaveText('9')

    const next = page.getByRole('combobox', { name: 'Career', exact: true })
    await next.selectOption({ label: 'Mind career' })
    await page.getByRole('button', { name: 'Start next career' }).click()
    await page.getByLabel('Career 2 Qualification dice').fill('12')
    const talents = page.getByRole('group', { name: 'Choose a talent' })
    await expect(talents.getByRole('button')).toHaveText(['Mindspeech', 'Farsight', 'Lifting', 'Finish career'])
  })
})
