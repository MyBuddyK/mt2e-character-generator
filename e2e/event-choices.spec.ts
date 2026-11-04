import { expect, test, type Page } from '@playwright/test'

/** Types `value` into the dice field of the step named `name` (for example "Term 1 Survival"). */
async function setDice(page: Page, name: string, value: number): Promise<void> {
  await page.getByLabel(`${name} dice`).fill(String(value))
}

/**
 * Opens ?seed=terms, imports e2e/fixtures/choices-pack.json, starts its Choices career, picks Service
 * skills for the term 1 skill roll, sets the term 1 survival dice to 12 and the event dice to `event`.
 */
async function startWithEvent(page: Page, event: number): Promise<void> {
  await page.goto('./?seed=terms')
  await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/choices-pack.json')
  await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Choices career' })
  await page.getByRole('button', { name: 'Start career' }).click()
  await page.getByRole('button', { name: 'Service skills' }).click()
  await setDice(page, 'Term 1 Survival', 12)
  await setDice(page, 'Term 1 Event', event)
}

// Browser tests for event and mishap choices and forward DMs (docs/features/event-choices.md), with the
// invented choices fixture pack and ?seed=terms.
test.describe('event choices and forward DMs', () => {
  // Sets the event to 7 (Admin 1 or DM +4 to the next advancement roll) and expects a choice group with
  // the event summary and both options. Picks the DM option and expects the event step to say so and the
  // advancement roll to give the DM's reason, with no Admin skill on the event step.
  // Criteria: EC-9.
  test('an event choice asks for the option and applies a forward DM to advancement', async ({ page }) => {
    await startWithEvent(page, 7)
    const group = page.getByRole('group', { name: 'Choose an option' })
    await expect(group.getByTestId('event-choice')).toContainText('Event: A supervisor takes an interest.')
    await expect(group.getByRole('button', { name: 'Admin 1' })).toBeVisible()
    await expect(page.getByTestId('step-term-1.advancement')).toHaveCount(0)

    await group.getByRole('button', { name: 'DM +4 to the next advancement roll' }).click()
    await expect(page.getByTestId('step-term-1.event')).toContainText('Chose: DM +4 to the next advancement roll')
    await expect(page.getByTestId('step-term-1.advancement').getByTestId('step-reason')).toContainText(['DM +4 from an event.'])
    await expect(page.getByRole('button', { name: 'Continue in career' })).toBeVisible()
  })

  // Sets the event to 9 (DM +2 for one later advancement roll, applied by hand) and the advancement dice
  // to 2. Expects no DM reason on advancement until Term 1 Advancement is picked in the DM's select, then
  // the reason; picking Not applied removes it. Leaves, takes a benefit, and expects the finished summary
  // to list the DM as not applied.
  // Criteria: EC-6, EC-8, EC-9.
  test('a held DM is applied to the roll the player picks', async ({ page }) => {
    await startWithEvent(page, 9)
    await setDice(page, 'Term 1 Advancement', 2)
    const advancement = page.getByTestId('step-term-1.advancement')
    const select = page.getByRole('combobox', { name: 'Term 1 Event DM +2 applies to' })
    await expect(page.getByTestId('step-term-1.event').getByTestId('later-dm')).toContainText(
      'DM +2 for one later advancement roll, applied by hand',
    )
    await expect(advancement).not.toContainText('applied by the player')

    await select.selectOption({ label: 'Term 1 Advancement' })
    await expect(advancement.getByTestId('step-reason')).toContainText(['DM +2 from Term 1 Event, applied by the player.'])
    await select.selectOption({ label: 'Not applied' })
    await expect(advancement).not.toContainText('applied by the player')

    await page.getByRole('button', { name: 'Leave career' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('summary-later-dms')).toHaveText(
      'DMs not applied: DM +2 for one later advancement roll (Term 1 Event)',
    )
  })
})
