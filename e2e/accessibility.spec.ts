import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Runs axe-core on the whole page with the WCAG 2.0, 2.1 and 2.2 level A and AA rules, and returns
 * one line per violation: the rule id, its impact and the CSS targets of the failing nodes.
 */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return results.violations.map((v) => `${v.id} (${v.impact ?? 'no impact'}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

// Accessibility checks: each test brings the page to one state and expects axe-core to report no WCAG
// A or AA violations. axe-core finds only the issues its rules can detect from the page; it does not
// replace testing with a screen reader.
test.describe('accessibility', () => {
  // Opens ./?seed=terms and expects no violations on the first page a player sees.
  test('the start page has no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  // Starts the sample career, picks Service skills, and expects no violations with term 1 shown.
  test('a career term has no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await expect(page.getByTestId('step-term-1.survival')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  // Starts the sample career, clicks Finish career, and expects no violations on the finished summary.
  test('the finished character has no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByRole('button', { name: 'Finish career' }).click()
    await expect(page.getByTestId('career-summary')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  // Imports valid-pack.json and expects no violations with the pack row shown in Career data.
  test('the Career data section with a pack loaded has no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/valid-pack.json')
    await expect(page.getByTestId('pack-test-core')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  // Imports a file that is not JSON and expects no violations with the import alert shown.
  test('an import alert has no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/not-json.json')
    await expect(page.getByRole('alert')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  // Imports the choices fixture pack, starts its career with survival 12 and event 7, and expects no
  // violations with the event choice shown; then picks Admin 1, continues, sets term 2 survival to 12 and
  // the event to 9, and expects no violations with the held DM select shown.
  test('an event choice and a held DM have no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/choices-pack.json')
    await page.getByRole('combobox', { name: 'Career', exact: true }).selectOption({ label: 'Choices career' })
    await page.getByRole('button', { name: 'Start career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByLabel('Term 1 Survival dice').fill('12')
    await page.getByLabel('Term 1 Event dice').fill('7')
    await expect(page.getByRole('group', { name: 'Choose an option' })).toBeVisible()
    expect(await violations(page)).toEqual([])

    await page.getByRole('button', { name: 'Admin 1' }).click()
    await page.getByRole('button', { name: 'Continue in career' }).click()
    await page.getByRole('button', { name: 'Service skills' }).click()
    await page.getByLabel('Term 2 Survival dice').fill('12')
    await page.getByLabel('Term 2 Event dice').fill('9')
    await expect(page.getByRole('combobox', { name: 'Term 2 Event DM +2 applies to' })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  // Imports the species pack, picks Sample Ursine, and expects no violations with the Species column and
  // traits shown.
  test('a picked species has no axe violations', async ({ page }) => {
    await page.goto('./?seed=terms')
    await page.getByLabel('Import from file').setInputFiles('e2e/fixtures/species-pack.json')
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Ursine')
    await expect(page.getByTestId('species-traits')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })
})
