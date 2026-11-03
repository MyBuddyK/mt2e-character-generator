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

  // Clicks Finish career and expects the finished summary; then changes the first benefit's dice and
  // expects the summary still shown.
  test('finish career finishes the character and its choices can still be changed', async ({ page }) => {
    await startTerm1(page)
    await expect(page.getByTestId('policy-note')).toBeVisible()
    await page.getByRole('button', { name: 'Finish career' }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
    await expect(page.getByTestId('summary-skills')).toContainText('Vacc Suit')
    await page.getByLabel('Mustering out Cash roll dice').first().fill('1')
    await expect(page.getByTestId('career-summary')).toBeVisible()
  })

  // Sets term 1 survival to 2 (a mishap that forces the character out), clicks Finish career, and
  // expects a finished character with term 1 only.
  test('finish career musters out when a mishap forces the character out', async ({ page }) => {
    await startTerm1(page)
    await setDice(page, 'Term 1 Survival', 2)
    await page.getByRole('button', { name: 'Finish career' }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
    await expect(page.getByTestId('term-2')).toHaveCount(0)
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

  // Passes survival, sets the event to 7 (a wager on Gambler or Broker 8+), wagers 1 on Broker, sets
  // the wager dice to 12, and expects a pass with one extra benefit roll.
  test('a wager event bets benefit rolls on a skill roll', async ({ page }) => {
    await startEnforced(page)
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Event', 7)
    await page.getByRole('group', { name: 'Wager benefit rolls' }).getByRole('button', { name: 'Wager 1', exact: true }).click()
    await page.getByRole('group', { name: 'Choose a skill' }).getByRole('button', { name: 'Broker' }).click()
    await setDice(page, 'Term 1 Wager: Broker', 12)
    const wager = page.getByTestId('step-term-1.event.effect-0')
    await expect(wager.getByTestId('step-result')).toHaveText('Pass')
    await expect(wager).toContainText('1 extra benefit roll')
  })
})

// Browser tests for careers one after another, the Draft and commissions (docs/features/career-rules.md,
// part 2b), with the invented multi-career-pack.json.
test.describe('more than one career', () => {
  /** Opens ?seed=terms, imports multi-career-pack.json and starts the career labelled `label`. */
  async function startPackCareer(page: Page, label: string): Promise<void> {
    await page.goto('./?seed=terms')
    await importFixture(page, 'multi-career-pack.json')
    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label })
    await page.getByRole('button', { name: 'Start career' }).click()
  }

  // Starts Test fleet, sets its qualification result to Fail, takes the Draft, picks Debris sweep and
  // expects the drafted notice and term 1.
  test('a failed qualification offers the Draft and the fallback career', async ({ page }) => {
    await startPackCareer(page, 'Test fleet')
    await page.getByLabel('Career Qualification result').selectOption('fail')
    const failed = page.getByRole('group', { name: 'Qualification failed' })
    await expect(failed.getByRole('button', { name: 'Enter Test wanderer' })).toBeVisible()
    await failed.getByRole('button', { name: 'Take the Draft' }).click()
    await page.getByRole('group', { name: 'Choose an assignment' }).getByRole('button', { name: 'Debris sweep' }).click()
    await expect(page.getByTestId('career-entry')).toContainText('Drafted into Test fleet')
    await expect(page.getByTestId('term-1')).toBeVisible()
  })

  // Starts Test fleet, passes qualification and survival, tries for a commission with dice 12, and
  // expects officer rank 1 Ensign and the Officer skills table offered for the extra skill roll.
  test('a commission makes the character an officer', async ({ page }) => {
    await startPackCareer(page, 'Test fleet')
    await setDice(page, 'Career Qualification', 12)
    await page.getByRole('button', { name: 'Service skills' }).click()
    await setDice(page, 'Term 1 Survival', 12)
    await page.getByRole('group', { name: 'Commission' }).getByRole('button', { name: 'Try for commission' }).click()
    await setDice(page, 'Term 1 Commission', 12)
    await expect(page.getByTestId('term-1').getByTestId('term-rank')).toHaveText('officer rank 1 Ensign')
    await expect(page.getByRole('group', { name: 'Choose a skill table' }).getByRole('button', { name: 'Officer skills' })).toBeVisible()
  })

  // Serves one term of Test wanderer and musters out, then expects the next-career picker without Test
  // wanderer, starts Test fleet, and expects career 2 with the earlier-career DM and term 2 asking for
  // one basic training skill.
  test('after mustering out the character can enter another career', async ({ page }) => {
    await startPackCareer(page, 'Test wanderer')
    await page.getByRole('button', { name: 'Service skills' }).click()
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Advancement', 2)
    await page.getByRole('button', { name: 'Leave career' }).click()
    await page.getByRole('button', { name: 'Benefit', exact: true }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
    const next = page.getByTestId('next-career')
    const select = next.getByRole('combobox', { name: 'Career', exact: true })
    await expect(select.locator('option', { hasText: 'Test wanderer' })).toHaveCount(0)
    await select.selectOption({ label: 'Test fleet' })
    await next.getByRole('button', { name: 'Start next career' }).click()
    await expect(page.getByTestId('career-run-2')).toContainText('Test fleet')
    await expect(page.getByTestId('step-career-2.qualification').getByTestId('step-reason')).toContainText('DM -1 for 1 earlier career.')
    await setDice(page, 'Career 2 Qualification', 12)
    await expect(page.getByTestId('term-2')).toContainText('Basic training: Service skills (one skill)')
    await expect(page.getByRole('group', { name: 'Choose a skill' })).toBeVisible()
  })
})

// Browser tests for aging choices and anagathics (docs/features/career-rules.md, "Aging"), with the
// invented multi-career-pack.json, whose aging starts in term 1.
test.describe('aging and anagathics', () => {
  /** Opens ?seed=terms, imports multi-career-pack.json, starts Test wanderer and picks Service skills. */
  async function startWanderer(page: Page): Promise<void> {
    await page.goto('./?seed=terms')
    await importFixture(page, 'multi-career-pack.json')
    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Test wanderer' })
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
  }

  // Sets the term 1 aging dice to 2 (reduce two physical characteristics by 2 and 1), expects the
  // characteristic choice, then ticks Ignore and expects the choice gone and the after-term choice shown.
  test('aging asks which characteristic to reduce, and can be ignored', async ({ page }) => {
    await startWanderer(page)
    await setDice(page, 'Term 1 Survival', 12)
    await setDice(page, 'Term 1 Advancement', 2)
    await setDice(page, 'Term 1 Aging', 2)
    const pick = page.getByRole('group', { name: 'Choose a characteristic' })
    await expect(pick).toContainText('Reduce which characteristic by 2?')
    await page.getByRole('checkbox', { name: /Ignore this aging result/ }).check()
    await expect(pick).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'After this term' })).toBeVisible()
  })

  // Ticks Anagathics for term 1, sets the SOC roll to 12, and expects the cost roll and a second survival roll.
  test('anagathics add a cost and a second survival roll', async ({ page }) => {
    await startWanderer(page)
    await page.getByRole('checkbox', { name: 'Anagathics in term 1' }).check()
    await setDice(page, 'Term 1 Anagathics', 12)
    await expect(page.getByTestId('step-term-1.anagathics-cost')).toBeVisible()
    await expect(page.getByTestId('step-term-1.survival-2')).toBeVisible()
  })
})
