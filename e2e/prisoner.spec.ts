import { expect, test } from '@playwright/test'

// Browser tests for forced-entry careers and the Parole Threshold (docs/features/prisoner-psion.md), with the
// invented e2e/fixtures/prisoner-pack.json and ?seed=terms.
test.describe('Prisoner career rules', () => {
  // Imports the pack and expects the career pick to list the Sending career and not the Holding career.
  // Criteria: PP-1.
  test('a forced-entry career is not listed at the career pick', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/prisoner-pack.json')
    const pick = page.getByRole('combobox', { name: 'Career', exact: true })
    await expect(pick.locator('option', { hasText: 'Sending career' })).toHaveCount(1)
    await expect(pick.locator('option', { hasText: 'Holding career' })).toHaveCount(0)
  })

  // Plays the Sending career's roll 8 event into the Holding career, picks the Cellblock, and expects the
  // pack's anagathics offered in the Sending career's term but not in the Holding career's. Sets the Parole
  // Threshold dice to 2 (a threshold of 4) and advancement dice to 5 (a total of 4 with this seed's STR DM of
  // -1), and expects the Parole Threshold step and a forced continue; then dice of 12 (a total of 11), and
  // expects a forced muster out.
  // Criteria: PP-2, PP-6, PP-13.
  test('the Parole Threshold decides when the Holding career ends', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/prisoner-pack.json')
    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Sending career' })
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByLabel('Term 1 Survival dice').fill('12')
    await page.getByLabel('Term 1 Event dice').fill('8')
    await page.getByLabel('Term 1 Advancement dice').fill('2')
    await page.getByRole('button', { name: 'Muster out' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await page.getByRole('button', { name: 'Cellblock' }).click()
    await expect(page.getByTestId('career-run-2').getByTestId('career-entry')).toHaveText('An event sent the character to Holding career.')
    await expect(page.getByRole('checkbox', { name: 'Anagathics in term 1' })).toHaveCount(1)
    await expect(page.getByRole('checkbox', { name: 'Anagathics in term 2' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Athletics' }).click()
    await page.getByLabel('Term 2 Parole Threshold dice').fill('2')
    await expect(page.getByTestId('step-career-2.term-1.parole')).toContainText('4')
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByLabel('Term 2 Survival dice').fill('12')
    await page.getByLabel('Term 2 Event dice').fill('7')
    await page.getByLabel('Term 2 Advancement dice').fill('5')
    await expect(page.getByText('Advancement 4 is not above the Parole Threshold 4, so the character must continue.').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Muster out' })).toHaveCount(0)

    await page.getByLabel('Term 2 Advancement dice').fill('12')
    await page.getByRole('button', { name: 'Service skills' }).click()
    await expect(page.getByText('Advancement 11 is above the Parole Threshold 4, so the sentence ends after this term.').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Muster out' })).toBeVisible()
  })
})
