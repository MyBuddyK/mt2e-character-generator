import { expect, test, type Page } from '@playwright/test'

const SPECIES_PACK = 'e2e/fixtures/species-pack.json'

/** Imports e2e/fixtures/species-pack.json and waits for its row in Career data. */
async function importSpeciesPack(page: Page): Promise<void> {
  await page.getByLabel('Import from file').setInputFiles(SPECIES_PACK)
  await expect(page.getByTestId('pack-species-test')).toBeVisible()
}

/** Returns the number in a characteristic row's Value field. */
async function valueOf(page: Page, key: string): Promise<number> {
  return Number(await page.getByLabel(`${key} value`).inputValue())
}

/** Returns the dice total shown in a characteristic row's Roll cell. */
async function rollOf(page: Page, key: string): Promise<number> {
  return Number(await page.getByTestId(`char-${key}`).getByRole('cell').first().textContent())
}

// Browser tests for the Species select, the Species column, traits and the saved species (docs/features/species.md).
test.describe('species', () => {
  // Loads ?seed=species with no pack and expects a Species select whose only option is Human, and no
  // Species column.
  // Criteria: SP-1.
  test('with no pack, only Human is offered and there is no Species column', async ({ page }) => {
    await page.goto('./?seed=species')
    const select = page.getByRole('combobox', { name: 'Species', exact: true })
    await expect(select).toHaveValue('human')
    await expect(select.getByRole('option')).toHaveText(['Human'])
    await expect(page.getByRole('columnheader', { name: 'Species' })).toHaveCount(0)
  })

  // Imports the species pack, picks Sample Ursine, and expects STR to be its roll + 3 with "+3" in the
  // Species column, DEX roll - 1 (at least 1), the UPP to change, and the two traits listed with the source.
  // Criteria: SP-2, SP-9.
  test('picking a species shows the modifiers, the modified values and the traits', async ({ page }) => {
    await page.goto('./?seed=species')
    const humanUpp = await page.getByTestId('upp').textContent()
    await importSpeciesPack(page)
    await expect(page.getByRole('combobox', { name: 'Species', exact: true }).getByRole('option')).toHaveText(['Human', 'Sample Mite', 'Sample Ursine'])
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Ursine')

    await expect(page.getByRole('columnheader', { name: 'Species' })).toBeVisible()
    await expect(page.getByTestId('species-mod-STR')).toHaveText('+3')
    await expect(page.getByTestId('species-mod-DEX')).toHaveText('-1')
    await expect(page.getByTestId('species-mod-END')).toHaveText('0')
    expect(await valueOf(page, 'STR')).toBe((await rollOf(page, 'STR')) + 3)
    expect(await valueOf(page, 'DEX')).toBe(Math.max(1, (await rollOf(page, 'DEX')) - 1))
    await expect(page.getByTestId('upp')).not.toHaveText(humanUpp ?? 'missing UPP')

    const traits = page.getByTestId('species-traits')
    await expect(traits.getByRole('listitem')).toHaveText([/^Thick Hide: /, /^Keen Nose: /])
    await expect(traits).toContainText('Source: Invented sample')
  })

  // Picks Sample Mite (STR -12, at least 1) and expects STR to be 1 for this seed.
  // Criteria: SP-2.
  test('a modifier that goes below the minimum gives the minimum', async ({ page }) => {
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Mite')
    await expect(page.getByLabel('STR value')).toHaveValue('1')
  })

  // Picks Sample Ursine, types 4 into STR, and expects STR overridden at 4; then clicks Reset and expects
  // STR back at its modified value.
  // Criteria: SP-4.
  test('an override replaces the modified value and Reset returns to it', async ({ page }) => {
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Ursine')
    const modified = await valueOf(page, 'STR')
    await page.getByLabel('STR value').fill('4')
    await page.getByLabel('STR value').press('Enter')
    await expect(page.getByTestId('overridden-STR')).toBeVisible()
    await expect(page.getByLabel('STR value')).toHaveValue('4')
    await page.getByRole('button', { name: 'Reset STR to modified value' }).click()
    await expect(page.getByLabel('STR value')).toHaveValue(String(modified))
    await expect(page.getByTestId('overridden-STR')).toHaveCount(0)
  })

  // Picks Sample Ursine, reloads the same seed, and expects Sample Ursine still picked.
  // Criteria: SP-6.
  test('the species picked for a seed comes back after a reload', async ({ page }) => {
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Ursine')
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('sample-ursine')
    await expect(page.getByTestId('species-traits')).toBeVisible()
  })

  // Saves Sample Ursine for the seed with no pack loaded, opens the seed, and expects the missing species
  // notice and the same UPP as Human; then imports the pack and expects the notice gone and the species picked.
  // Criteria: SP-7.
  test('a saved species that no pack defines is shown as Human with a notice', async ({ page }) => {
    await page.goto('./?seed=species')
    const humanUpp = await page.getByTestId('upp').textContent()
    await page.evaluate(() => localStorage.setItem('mt2e.species.v1', JSON.stringify({ species: 'sample-ursine' })))
    await page.reload()
    await expect(page.getByTestId('missing-species')).toContainText('sample-ursine')
    await expect(page.getByTestId('upp')).toHaveText(humanUpp ?? 'missing UPP')
    await importSpeciesPack(page)
    await expect(page.getByTestId('missing-species')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('sample-ursine')
  })

  // Imports the species pack, opens the pack's problems, and expects the invalid species entry listed.
  // Criteria: SP-8.
  test('an invalid species entry is listed in the pack problems', async ({ page }) => {
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    const row = page.getByTestId('pack-species-test')
    await row.getByText('some careers or species were skipped').click()
    await expect(row.getByRole('listitem').filter({ hasText: 'species.2 (broken-species)' })).toBeVisible()
  })

  // Picks Sample Ursine, clicks Reroll, and expects a new seed with Sample Ursine still picked.
  // Criteria: SP-10.
  test('Reroll keeps the picked species', async ({ page }) => {
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Ursine')
    await page.getByRole('button', { name: 'Reroll' }).click()
    await expect(page).not.toHaveURL(/seed=species(&|$)/)
    await expect(page.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('sample-ursine')
  })

  // Opens ./?seed=__proto__ and expects the page with Human picked and no missing species notice; then
  // imports the pack, picks Sample Ursine, reloads, and expects it still picked.
  // Criteria: SP-13.
  test('a seed named __proto__ saves and reads its species', async ({ page }) => {
    await page.goto('./?seed=__proto__')
    const select = page.getByRole('combobox', { name: 'Species', exact: true })
    await expect(select).toHaveValue('human')
    await expect(page.getByTestId('missing-species')).toHaveCount(0)
    await importSpeciesPack(page)
    await select.selectOption('Sample Ursine')
    await page.reload()
    await expect(select).toHaveValue('sample-ursine')
  })

  // As Human, overrides STR with its roll + 3, picks Sample Ursine (whose modified STR is roll + 3) and
  // expects STR not overridden; then picks Human and expects STR back at its roll with no override.
  // Criteria: SP-16.
  test('changing species removes an override equal to the new modified value', async ({ page }) => {
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    const roll = await rollOf(page, 'STR')
    await page.getByLabel('STR value').fill(String(roll + 3))
    await page.getByLabel('STR value').press('Enter')
    await expect(page.getByTestId('overridden-STR')).toBeVisible()
    const select = page.getByRole('combobox', { name: 'Species', exact: true })
    await select.selectOption('Sample Ursine')
    await expect(page.getByTestId('overridden-STR')).toHaveCount(0)
    await expect(page.getByLabel('STR value')).toHaveValue(String(roll + 3))
    await select.selectOption('Human')
    await expect(page.getByLabel('STR value')).toHaveValue(String(roll))
    await expect(page.getByTestId('overridden-STR')).toHaveCount(0)
  })

  // Saves Sample Ursine for the seed with no pack loaded, opens it, clicks Reroll, and expects Human picked
  // for the new seed with no missing species notice.
  // Criteria: SP-17.
  test('Reroll does not carry a species that no pack defines', async ({ page }) => {
    await page.goto('./?seed=species')
    await page.evaluate(() => localStorage.setItem('mt2e.species.v1', JSON.stringify({ species: 'sample-ursine' })))
    await page.reload()
    await expect(page.getByTestId('missing-species')).toBeVisible()
    await page.getByRole('button', { name: 'Reroll' }).click()
    await expect(page).not.toHaveURL(/seed=species(&|$)/)
    await expect(page.getByTestId('missing-species')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Species', exact: true })).toHaveValue('human')
  })

  // Makes localStorage refuse writes to the species key, imports the pack, picks Sample Ursine, and expects
  // the notice that the species could not be saved, with the species still picked.
  // Criteria: SP-18.
  test('a failed species save shows a notice', async ({ page }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'mt2e.species.v1') throw new DOMException('full', 'QuotaExceededError')
        setItem.call(this, key, value)
      }
    })
    await page.goto('./?seed=species')
    await importSpeciesPack(page)
    await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Sample Ursine')
    await expect(page.getByTestId('species-save-failed')).toContainText('could not be saved in this browser')
    await expect(page.getByTestId('species-traits')).toBeVisible()
  })
})
