import { expect, test, type Page } from '@playwright/test'

/** Opens ./?seed=terms, picks `school` in the career pick and starts it. */
async function startSchool(page: Page, school: string): Promise<void> {
  await page.goto('./?seed=terms')
  await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: school })
  await expect(page.getByRole('combobox', { name: 'Assignment' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start education' }).click()
}

// Browser tests for the education term with the bundled sample schools (docs/features/education.md).
test.describe('education', () => {
  // Starts the sample trade school, passes entry, picks Admin and Broker, sets the event to 7 and graduation
  // to 12, and expects the term with its school name, "Graduated with honours." and the bonus for the sample
  // career. Then starts the sample career and expects the qualification DM from the school.
  // Criteria: ED-1, ED-4, ED-7, ED-8.
  test('a graduate starts the next career with the school’s bonus', async ({ page }) => {
    await startSchool(page, 'Sample: Orbital Trade School')
    await page.getByLabel('Term 1 Entry dice').fill('12')
    await page.getByRole('button', { name: 'Admin' }).click()
    await page.getByRole('button', { name: 'Broker' }).click()
    await page.getByLabel('Term 1 Event dice').fill('7')
    await page.getByLabel('Term 1 Graduation dice').fill('12')
    const block = page.getByTestId('education-1')
    await expect(block.getByTestId('term-education')).toHaveText('Sample: Orbital Trade School')
    await expect(block.getByTestId('education-outcome')).toHaveText('Graduated with honours.')
    await expect(block.getByTestId('education-bonuses')).toContainText('DM +2 to qualify for Sample: Orbital Sanitation as the next career.')

    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Sample: Orbital Sanitation' })
    await page.getByRole('button', { name: 'Start next career' }).click()
    await expect(page.getByTestId('step-career-2.qualification')).toContainText('DM +2 from graduating from Sample: Orbital Trade School.')
  })

  // Starts the sample trade school and fails entry, and expects the failed-entry notice, no term, and a
  // career pick with no education group.
  // Criteria: ED-3.
  test('a failed entry goes back to the career pick for the same term', async ({ page }) => {
    await startSchool(page, 'Sample: Orbital Trade School')
    await page.getByLabel('Term 1 Entry dice').fill('2')
    await expect(page.getByTestId('education-outcome')).toHaveText('Entry to Sample: Orbital Trade School failed. Pick a career for this term.')
    await expect(page.getByTestId('term-1')).toHaveCount(0)
    const pick = page.getByRole('combobox', { name: 'Career', exact: true })
    await expect(pick.locator('optgroup')).toHaveCount(0)
    await expect(pick.locator('option')).toHaveText(['Sample: Orbital Sanitation'])
  })
})
