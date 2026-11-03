import { expect, test, type Page } from '@playwright/test'

const FIXTURES = 'e2e/fixtures'

/** Opens ?seed=terms, clicks Start career with the sample career, and picks Service skills for the first skill roll. */
async function startTerm1(page: Page): Promise<void> {
  await page.goto('./?seed=terms')
  await page.getByRole('button', { name: 'Start career' }).click()
  await page.getByRole('button', { name: 'Service skills' }).click()
  await expect(page.getByTestId('step-term-1.survival')).toBeVisible()
}

/** Types `value` into the dice field of the step named `name` (for example "Term 1 Survival"). */
async function setDice(page: Page, name: string, value: number): Promise<void> {
  await page.getByLabel(`${name} dice`).fill(String(value))
}

/** Picks the fixture file `name` with the Import from file control. */
async function importFixture(page: Page, name: string): Promise<void> {
  await page.getByLabel('Import from file').setInputFiles(`${FIXTURES}/${name}`)
}

// Browser tests for the Career section: starting a career, terms, overrides and mustering out.
test.describe('career terms', () => {
  // Starts the sample career with ?seed=terms in two separate pages and expects the same first term.
  test('the same seed gives the same first term', async ({ browser }) => {
    const texts: string[] = []
    for (let i = 0; i < 2; i += 1) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await startTerm1(page)
      texts.push((await page.getByTestId('term-1').locator('.steps').textContent()) ?? '')
      await context.close()
    }
    expect(texts[0]).not.toBe('')
    expect(texts[0]).toBe(texts[1])
  })

  // Sets the term 1 survival dice to 2 and expects a mishap, no event, no advancement roll and only
  // Muster out; then clicks Reset and expects the event and advancement roll back.
  test('a failing survival roll gives a mishap; reset brings back the event', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 2)
    await expect(page.getByTestId('step-term-1.mishap')).toBeVisible()
    await expect(page.getByTestId('step-term-1.event')).toHaveCount(0)
    await expect(page.getByTestId('step-term-1.advancement')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Muster out' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue in career' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Reset Term 1 Survival' }).click()
    await expect(page.getByTestId('step-term-1.event')).toBeVisible()
    await expect(page.getByTestId('step-term-1.advancement')).toBeVisible()
  })

  // Sets the term 1 event dice to 3 (a connection event) and expects the Connection marker on it.
  test('a connection event shows the Connection marker', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Event', 3)
    await expect(page.getByTestId('step-term-1.event').getByTestId('connection-marker')).toBeVisible()
  })

  // Sets the event dice to 6 (gain Mechanic or Engineer), picks Engineer, and expects Engineer 1 applied.
  test('an event with a skill effect adds the chosen skill', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Event', 6)
    await page.getByRole('group', { name: 'Choose a skill' }).getByRole('button', { name: 'Engineer' }).click()
    await expect(page.getByTestId('step-term-1.event')).toContainText('Applied: Engineer 1')
  })

  // Sets the event dice to 9 (no effects) and expects its summary as an apply-by-hand note.
  test('an event without effects is shown as a note', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Event', 9)
    await expect(page.getByTestId('step-term-1.event')).toContainText('Apply by hand: A rival crew')
  })

  // Passes term 1, clicks Continue in career, and expects term 2 to start four years later (the sample term length).
  test('continue in career adds a term four years later', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 12)
    await page.getByRole('button', { name: 'Continue in career' }).click()
    await expect(page.getByTestId('term-1').getByTestId('term-age')).toHaveText('age 18-22')
    await expect(page.getByTestId('term-2').getByTestId('term-age')).toHaveText('age 22-26')
  })

  // Clicks Generate the rest and expects the finished summary; then changes the first benefit's
  // dice and expects the summary still shown.
  test('generate the rest finishes the character and its choices can still be changed', async ({ page }) => {
    await startTerm1(page)
    await expect(page.getByTestId('policy-note')).toBeVisible()
    await page.getByRole('button', { name: 'Generate the rest' }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
    await expect(page.getByTestId('summary-skills')).toContainText('Vacc Suit')
    await page.getByLabel('Mustering out Cash roll dice').first().fill('1')
    await expect(page.getByTestId('career-summary')).toBeVisible()
  })

  // Finishes term 1 (survival 12, event 9, advancement 2), sets More terms to 1, clicks Generate the
  // rest, and expects a finished character with terms 1 and 2 only.
  test('generate the rest plays the number of terms asked for', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Event', 9)
    await setDice(page, 'Term 1 Advancement', 2)
    await page.getByLabel('More terms').fill('1')
    await page.getByRole('button', { name: 'Generate the rest' }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
    await expect(page.getByTestId('term-2')).toBeVisible()
    await expect(page.getByTestId('term-3')).toHaveCount(0)
  })

  // Sets the term 1 event to 3 (a connection event that also offers Medic or Vacc Suit), picks
  // Medic, leaves, takes a benefit, and expects the event in the Connection opportunities list.
  test('the finished character lists connection opportunities', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Event', 3)
    await page.getByRole('group', { name: 'Choose a skill' }).getByRole('button', { name: 'Medic' }).click()
    await setDice(page, 'Term 1 Advancement', 2)
    await page.getByRole('button', { name: 'Leave career' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('connections')).toContainText('Term 1, Event: You pull an escape pod')
  })

  // Leaves after term 1, takes one benefit, and expects one benefit roll (the sample's one per term).
  test('leaving gives the benefit rolls set in the rules', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Advancement', 2)
    await page.getByRole('button', { name: 'Leave career' }).click()
    await expect(page.getByText('Benefit roll 1 of 1')).toBeVisible()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('benefits').getByRole('listitem')).toHaveCount(1)
  })

  // Types a term note, reloads, and expects the started career, the chosen table and the note still there.
  test('choices, overrides and notes are kept after a reload', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 12)
    await page.getByLabel('Term 1 notes').fill('Met Rin on the hulk')
    await page.reload()
    await expect(page.getByLabel('Term 1 notes')).toHaveValue('Met Rin on the hulk')
    await expect(page.getByLabel('Term 1 Survival dice')).toHaveValue('12')
  })

  // Loads the page with only bundled data and expects the sample rules notice.
  test('the sample rules notice is shown with only bundled data', async ({ page }) => {
    await page.goto('./?seed=terms')
    await expect(page.getByTestId('sample-rules-notice')).toBeVisible()
  })

  // Sets a 320px viewport, plays three terms with survival passed, a plain event (9) and a failed
  // advancement in each, and expects no sideways scrolling.
  test('the Career section fits at 320px with three terms', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await startTerm1(page)
    for (const term of [1, 2, 3]) {
      if (term > 1) {
        await page.getByRole('button', { name: 'Continue in career' }).click()
        await page.getByRole('button', { name: 'Service skills' }).click()
      }
      await setDice(page, `Term ${term} Survival`, 12)
      await setDice(page, `Term ${term} Event`, 9)
      await setDice(page, `Term ${term} Advancement`, 2)
    }
    await expect(page.getByTestId('term-3')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })

  // Starts the career and picks the skill table with the keyboard only, and expects term 1 to show.
  test('the Career section works with the keyboard', async ({ page }) => {
    await page.goto('./?seed=terms')
    const start = page.getByRole('button', { name: 'Start career' })
    await start.focus()
    await page.keyboard.press('Enter')
    const table = page.getByRole('button', { name: 'Service skills' })
    await table.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('step-term-1.survival')).toBeVisible()
  })
})

// Browser tests for rules and saved choices with career packs.
test.describe('career terms with packs', () => {
  // Starts the sample career, imports valid-pack.json, and expects the saved-choices notice; clicking
  // Start over clears it, and it stays gone after a reload.
  test('saved choices made with other packs ask before applying', async ({ page }) => {
    await startTerm1(page)
    await importFixture(page, 'valid-pack.json')
    await expect(page.getByTestId('saved-choices-notice')).toBeVisible()
    await expect(page.getByTestId('step-term-1.survival')).toHaveCount(0)
    await page.getByRole('button', { name: 'Start over' }).click()
    await expect(page.getByTestId('saved-choices-notice')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('saved-choices-notice')).toHaveCount(0)
  })

  // Imports two packs with different rules in both orders and expects the notice to name Rules pack A each time.
  test('with two packs that have different rules, the first by id is used', async ({ page }) => {
    await page.goto('./?seed=terms')
    for (const order of [
      ['rules-pack-a.json', 'rules-pack-b.json'],
      ['rules-pack-b.json', 'rules-pack-a.json'],
    ]) {
      for (const name of order) await importFixture(page, name)
      await expect(page.getByTestId('rules-notice')).toContainText('"Rules pack A"')
      await page.getByRole('button', { name: 'Remove Rules pack A' }).click()
      await page.getByRole('button', { name: 'Remove Rules pack B' }).click()
    }
  })

  // Imports a version 1 pack whose careers use effects and expects an alert that it must be version 2.
  test('a version 1 pack that uses effects is rejected', async ({ page }) => {
    await page.goto('./?seed=terms')
    await importFixture(page, 'v1-effects-pack.json')
    await expect(page.getByRole('alert')).toContainText('so its "formatVersion" must be 2')
  })

  // Expects the Career data section to link to the README section on writing a career pack.
  test('the Career data section links to the pack guide', async ({ page }) => {
    await page.goto('./?seed=terms')
    await expect(page.getByRole('link', { name: 'How to write a career pack' })).toHaveAttribute(
      'href',
      'https://github.com/MyBuddyK/mt2e-character-generator#writing-a-career-pack',
    )
  })
})

// Browser tests for the rules that a pack's rules values switch on (docs/features/career-rules.md).
test.describe('career rule enforcement', () => {
  /** Opens ?seed=terms, imports rules-enforced-pack.json, starts its career and picks Service skills. */
  async function startEnforced(page: Page): Promise<void> {
    await page.goto('./?seed=terms')
    await importFixture(page, 'rules-enforced-pack.json')
    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Enforced career' })
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await expect(page.getByTestId('step-term-1.survival')).toBeVisible()
  }

  // Sets the survival dice to 2 against a 2+ target and expects Fail with the natural-2 reason and a mishap.
  test('a natural 2 fails survival and says why', async ({ page }) => {
    await startEnforced(page)
    await setDice(page, 'Term 1 Survival', 2)
    const survival = page.getByTestId('step-term-1.survival')
    await expect(survival.getByTestId('step-result')).toHaveText('Fail')
    await expect(survival.getByTestId('step-reason')).toContainText('Natural 2')
    await expect(page.getByTestId('step-term-1.mishap')).toBeVisible()
  })

  // Passes survival with event 9, rolls advancement 12, picks Service skills for the extra roll, and
  // expects the natural-12 reason with Continue in career and no Leave career button.
  test('a natural 12 on advancement offers only Continue in career', async ({ page }) => {
    await startEnforced(page)
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Event', 9)
    await setDice(page, 'Term 1 Advancement', 12)
    await page.getByRole('button', { name: 'Service skills' }).click()
    const next = page.getByRole('group', { name: 'After this term' })
    await expect(next).toContainText('Natural 12 on advancement')
    await expect(next.getByRole('button', { name: 'Continue in career' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave career' })).toHaveCount(0)
  })
})
