import { expect, test, type Page } from '@playwright/test'

/** Types `value` into the dice field of the step named `name` (for example "Term 1 Survival"). */
async function setDice(page: Page, name: string, value: number): Promise<void> {
  await page.getByLabel(`${name} dice`).fill(String(value))
}

/**
 * Opens ?seed=terms, starts the sample career and plays `terms` terms, picking Service skills for
 * each skill roll and setting each term's survival dice to 12, event dice to 9 (an event with no
 * effects) and advancement dice to 2, with Continue in career between terms. Stops at the end of the
 * last term, with the after-term choice pending.
 */
async function playTerms(page: Page, terms: number): Promise<void> {
  await page.goto('./?seed=terms')
  await page.getByRole('button', { name: 'Start career' }).click()
  for (let term = 1; term <= terms; term += 1) {
    if (term > 1) await page.getByRole('button', { name: 'Continue in career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await setDice(page, `Term ${term} Survival`, 12)
    await setDice(page, `Term ${term} Event`, 9)
    await setDice(page, `Term ${term} Advancement`, 2)
  }
  await expect(page.getByRole('button', { name: 'Continue in career' })).toBeVisible()
}

// Browser tests for removing the most recent term (docs/features/term-removal.md), with the bundled
// sample career and ?seed=terms.
test.describe('removing the most recent term', () => {
  // Plays three terms and expects one Remove term button, on term 3. Removes term 3, then term 2, then
  // term 1, and after each removal expects the term gone, the button on the term before it with
  // keyboard focus, and a notice naming the removed term; after the last removal expects focus on
  // Start career.
  // Criteria: TR-1, TR-3, TR-4, TR-8, TR-9.
  test('terms can be removed one at a time back to the career pick', async ({ page }) => {
    await playTerms(page, 3)
    await expect(page.getByTestId('remove-term')).toHaveCount(1)
    await expect(page.getByTestId('term-3').getByRole('button', { name: 'Remove term 3' })).toBeVisible()

    for (const term of [3, 2]) {
      await page.getByRole('button', { name: `Remove term ${term}` }).click()
      await expect(page.getByTestId(`term-${term}`)).toHaveCount(0)
      await expect(page.getByTestId('removed-term-notice')).toHaveText(
        `Removed term ${term}. The character is back at the end of term ${term - 1}.`,
      )
      await expect(page.getByTestId('remove-term')).toHaveCount(1)
      await expect(page.getByTestId(`term-${term - 1}`).getByRole('button', { name: `Remove term ${term - 1}` })).toBeFocused()
      await expect(page.getByRole('button', { name: 'Continue in career' })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Remove term 1' }).click()
    await expect(page.getByTestId('term-1')).toHaveCount(0)
    await expect(page.getByTestId('removed-term-notice')).toHaveText('Removed term 1. Pick a career to start again.')
    await expect(page.getByRole('button', { name: 'Start career' })).toBeFocused()
  })

  // Plays one term, continues, sets the term 2 event dice to 6 and picks Engineer, leaves and takes
  // two benefits, and expects Engineer 1 in the finished summary. Removes term 2 and expects the
  // summary and mustering out gone with Continue in career offered; then leaves after term 1, takes a
  // benefit, and expects a finished summary with no Engineer and one benefit roll.
  // Criteria: TR-2, TR-5, TR-6.
  test('removing a term after mustering out undoes its skill and the mustering out', async ({ page }) => {
    await playTerms(page, 1)
    await page.getByRole('button', { name: 'Continue in career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await setDice(page, 'Term 2 Survival', 12)
    await setDice(page, 'Term 2 Event', 6)
    await page.getByRole('group', { name: 'Choose a skill' }).getByRole('button', { name: 'Engineer' }).click()
    await setDice(page, 'Term 2 Advancement', 2)
    await page.getByRole('button', { name: 'Leave career' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('summary-skills')).toContainText('Engineer 1')
    await expect(page.getByTestId('summary-age')).toHaveText('26')

    await page.getByRole('button', { name: 'Remove term 2' }).click()
    await expect(page.getByTestId('career-summary')).toHaveCount(0)
    await expect(page.getByTestId('benefits')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continue in career' })).toBeVisible()

    await page.getByRole('button', { name: 'Leave career' }).click()
    await expect(page.getByText('Benefit roll 1 of 1')).toBeVisible()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('summary-age')).toHaveText('22')
    await expect(page.getByTestId('summary-skills')).not.toContainText('Engineer')
    await expect(page.getByTestId('benefits').getByRole('listitem')).toHaveCount(1)
  })

  // Plays two terms, removes term 2, clicks Continue in career and picks
  // Service skills, and expects a term 2 aged 22-26; then clicks Finish career and expects the
  // finished summary.
  // Criteria: TR-5.
  test('continue and Finish career go on from the end of the term before', async ({ page }) => {
    await playTerms(page, 2)
    await page.getByRole('button', { name: 'Remove term 2' }).click()
    await page.getByRole('button', { name: 'Continue in career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await expect(page.getByTestId('term-2').getByTestId('term-age')).toHaveText('age 22-26')
    await page.getByRole('button', { name: 'Finish career' }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
  })

  // Plays two terms, types a note in each, expects a term 2 survival override, removes term 2, and expects the term 1 note and survival
  // override kept; reloads and expects term 1 with its note and override, no term 2, and the after-term
  // choice offered; then continues and expects an empty term 2 note and no term 2 survival override.
  // Criteria: TR-7.
  test('removal deletes the term’s notes and overrides and is kept after a reload', async ({ page }) => {
    await playTerms(page, 2)
    await page.getByLabel('Term 1 notes').fill('Met Rin on the hulk')
    await page.getByLabel('Term 2 notes').fill('Lost the tug')
    await expect(page.getByRole('button', { name: 'Reset Term 2 Survival' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove term 2' }).click()
    await expect(page.getByLabel('Term 1 notes')).toHaveValue('Met Rin on the hulk')

    await page.reload()
    await expect(page.getByLabel('Term 1 notes')).toHaveValue('Met Rin on the hulk')
    await expect(page.getByLabel('Term 1 Survival dice')).toHaveValue('12')
    await expect(page.getByTestId('term-2')).toHaveCount(0)
    await page.getByRole('button', { name: 'Continue in career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await expect(page.getByLabel('Term 2 notes')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Reset Term 2 Survival' })).toHaveCount(0)
  })
})
