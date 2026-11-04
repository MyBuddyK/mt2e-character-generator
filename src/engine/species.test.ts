import { describe, expect, it } from 'vitest'
import { parseCareerPack } from './career-pack'
import { newCharacter, overrideCharacteristic } from './character'
import { characteristicDM, type Characteristics } from './characteristics'
import { current, isOverridden } from './overridable'
import {
  HUMAN,
  applySpecies,
  combineSpecies,
  dropMatchingOverrides,
  parseSpecies,
  speciesBase,
  speciesValue,
  type SpeciesDefinition,
} from './species'
import { buildCareer, EMPTY_INPUT, type CareerData } from './terms'
import { sampleRules } from '../data/rules'
import { readSavedSpecies, SPECIES_KEY, writeSavedSpecies } from '../storage/species'
import speciesPack from '../../e2e/fixtures/species-pack.json'
import validPack from '../../e2e/fixtures/valid-pack.json'

/** An invented species: STR +3, DEX -1, at least 1, with one trait. */
const URSINE: SpeciesDefinition = {
  id: 'sample-ursine',
  name: 'Sample Ursine',
  source: 'Invented sample',
  summary: 'Invented.',
  modifiers: { STR: 3, DEX: -1 },
  minCharacteristic: 1,
  traits: [{ name: 'Thick Hide', summary: 'Invented.' }],
}

/** Returns characteristics with every dice total set to `value` and no overrides. */
function allRolled(value: number): Characteristics {
  const one = { rolled: value }
  return { STR: one, DEX: one, END: one, INT: one, EDU: one, SOC: one }
}

/** An in-memory Storage. When `failWrites` is true, setItem throws. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  failWrites = false
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('quota')
    this.items.set(key, value)
  }
}

// Tests for speciesValue and applySpecies: how a species modifier changes a rolled characteristic.
describe('species modifiers', () => {
  // Applies DEX -1 with minCharacteristic 1 to dice totals 2 and 1, and expects 1 both times; then a DEX
  // -20 modifier with no minimum, and expects 0 (the lowest stored value).
  // Criteria: SP-3.
  it('raises a modified value below minCharacteristic to the minimum', () => {
    expect(speciesValue(2, URSINE, 'DEX')).toBe(1)
    expect(speciesValue(1, URSINE, 'DEX')).toBe(1)
    const noMinimum: SpeciesDefinition = { ...URSINE, modifiers: { DEX: -20 } }
    delete noMinimum.minCharacteristic
    expect(speciesValue(5, noMinimum, 'DEX')).toBe(0)
  })

  // Applies STR +3 to a dice total of 14 and expects 17, then STR +30 to 12 and expects 33 (the highest
  // stored value).
  // Criteria: SP-3.
  it('keeps a modified value above 15 and clamps it at 33', () => {
    expect(speciesValue(14, URSINE, 'STR')).toBe(17)
    expect(speciesValue(12, { ...URSINE, modifiers: { STR: 30 } }, 'STR')).toBe(33)
  })

  // Applies a species with minCharacteristic 1 and no END modifier to END dice totals of 0 and 3 with a
  // minimum of 5, and expects END to stay at its dice total each time.
  // Criteria: SP-15.
  it('does not raise a characteristic the species does not modify to minCharacteristic', () => {
    const highMinimum: SpeciesDefinition = { ...URSINE, minCharacteristic: 5 }
    expect(speciesValue(0, highMinimum, 'END')).toBe(0)
    expect(speciesValue(3, highMinimum, 'END')).toBe(3)
    expect(speciesValue(3, highMinimum, 'DEX')).toBe(5)
  })

  // Applies a species with no modifier for END and expects END to equal its dice total.
  it('leaves a characteristic with no listed modifier at its dice total', () => {
    expect(speciesValue(8, URSINE, 'END')).toBe(8)
    expect(applySpecies(allRolled(8), HUMAN)).toEqual(allRolled(8))
  })

  // Applies the species to characteristics where STR has an override of 4 and DEX an override equal to
  // its modified value, and expects STR's override kept and DEX's dropped.
  it('keeps an override that differs from the modified value and drops one equal to it', () => {
    const chars: Characteristics = { ...allRolled(7), STR: { rolled: 7, override: 4 }, DEX: { rolled: 7, override: 6 } }
    const applied = applySpecies(chars, URSINE)
    expect(applied.STR).toEqual({ rolled: 10, override: 4 })
    expect(applied.DEX).toEqual({ rolled: 6 })
  })
})

// Tests for dropMatchingOverrides: the overrides removed when the species in use changes.
describe('dropMatchingOverrides', () => {
  // Gives STR an override equal to Ursine's modified STR and DEX an override that differs, drops matching
  // overrides for Ursine, and expects only DEX's override kept; then switching back to Human shows STR
  // at its dice total.
  // Criteria: SP-16.
  it('removes an override equal to the new modified value and keeps the others', () => {
    const chars: Characteristics = { ...allRolled(7), STR: { rolled: 7, override: 10 }, DEX: { rolled: 7, override: 3 } }
    const dropped = dropMatchingOverrides(chars, URSINE)
    expect(dropped.STR).toEqual({ rolled: 7 })
    expect(dropped.DEX).toEqual({ rolled: 7, override: 3 })
    expect(current(applySpecies(dropped, HUMAN).STR)).toBe(7)
    expect(chars.STR).toEqual({ rolled: 7, override: 10 })
  })
})

// Tests for overrideCharacteristic with a species: the override is compared with the modified value.
describe('overrideCharacteristic with a species', () => {
  // Overrides STR with the modified value, then with the dice total, then removes the override, and
  // expects: no override, an override shown as overridden, then the modified value back.
  // Criteria: SP-4.
  it('replaces the modified value, and removing the override returns to it', () => {
    const character = newCharacter('species-override')
    const dice = character.characteristics.STR.rolled
    const modified = speciesValue(dice, URSINE, 'STR')

    const same = overrideCharacteristic(character, 'STR', modified, URSINE)
    expect(same.characteristics.STR).toEqual({ rolled: dice })

    const toDice = overrideCharacteristic(character, 'STR', dice, URSINE)
    const shown = applySpecies(toDice.characteristics, URSINE).STR
    expect(current(shown)).toBe(dice)
    expect(isOverridden(shown)).toBe(true)

    const reset = overrideCharacteristic(toDice, 'STR', undefined, URSINE)
    expect(current(applySpecies(reset.characteristics, URSINE).STR)).toBe(modified)
  })
})

// Tests for parseSpecies and the species field of a career pack.
describe('species in career packs', () => {
  // Parses e2e/fixtures/species-pack.json and expects its two valid species, its careers, and one problem
  // naming the invalid entry by index, id and field.
  // Criteria: SP-8.
  it('loads the valid species and careers and reports the invalid species entry', () => {
    const result = parseCareerPack(speciesPack)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.species.map((s) => s.id)).toEqual(['sample-ursine', 'sample-mite'])
    expect(result.careers.map((c) => c.id)).toEqual(['test-courier', 'test-surveyor'])
    expect(result.problems).toEqual([expect.stringMatching(/^species\.2 \(broken-species\): traits: /)])
  })

  // Adds a species list to the version 1 valid fixture and to a version 2 copy, and expects both
  // rejected with a message that the pack must say version 3.
  // Criteria: SP-11.
  it('requires format version 3 for species', () => {
    const reason = 'this pack uses "species", so its "formatVersion" must be 3'
    const v1 = { ...structuredClone(validPack), species: [URSINE] }
    expect(parseCareerPack(v1)).toMatchObject({ ok: false, reason })
    expect(parseCareerPack({ ...v1, formatVersion: 2 })).toMatchObject({ ok: false, reason })
    expect(parseCareerPack({ ...v1, formatVersion: 3 })).toMatchObject({ ok: true, species: [URSINE] })
  })

  // Parses a species with an unknown key and one with a modifier on an unknown characteristic, and
  // expects each rejected with the field named.
  it('rejects unknown keys and unknown characteristics', () => {
    expect(parseSpecies({ ...URSINE, size: 'large' })).toMatchObject({ ok: false, errors: [expect.stringContaining('size')] })
    expect(parseSpecies({ ...URSINE, modifiers: { PSI: 1 } })).toMatchObject({ ok: false, errors: [expect.stringContaining('modifiers')] })
  })

  // Puts two species with the same id in one pack and expects the second skipped and reported.
  it('skips a species whose id is used earlier in the same pack', () => {
    const pack = { ...structuredClone(speciesPack), species: [URSINE, { ...URSINE, name: 'Copy' }] }
    const result = parseCareerPack(pack)
    expect(result.ok && result.species.map((s) => s.name)).toEqual(['Sample Ursine'])
    expect(result.problems).toEqual(['species.1 (sample-ursine): id "sample-ursine" is used by an earlier species in this pack'])
  })
})

// Tests for combineSpecies: which species are offered when several packs are loaded.
describe('combineSpecies', () => {
  // Combines no packs and expects only Human.
  // Criteria: SP-1.
  it('offers only Human when no pack defines species', () => {
    expect(combineSpecies([])).toEqual({ species: [HUMAN], problems: [] })
    expect(combineSpecies([{ id: 'a', name: 'Pack A', species: [] }]).species).toEqual([HUMAN])
  })

  // Combines pack "b" with species Zed and a "human" species, and pack "a" with Ursine and a copy of
  // Zed's id; expects Human, Sample Ursine and pack a's species, sorted by name, and two problems.
  it('puts Human first, sorts by name, and reports reused ids', () => {
    const zed: SpeciesDefinition = { ...URSINE, id: 'zed', name: 'Zed' }
    const result = combineSpecies([
      { id: 'b', name: 'Pack B', species: [zed, { ...URSINE, id: 'human', name: 'Other human' }] },
      { id: 'a', name: 'Pack A', species: [URSINE, { ...zed, name: 'A Zed' }] },
    ])
    expect(result.species.map((s) => s.name)).toEqual(['Human', 'A Zed', 'Sample Ursine'])
    expect(result.problems).toEqual([
      'Pack B: species id "zed" is already used by Pack A',
      'Pack B: species id "human" is already used by the built-in Human',
    ])
  })
})

// Tests for readSavedSpecies and writeSavedSpecies in storage/species.ts, using an in-memory Storage.
describe('saved species', () => {
  // Saves Ursine for one seed and expects it read back for that seed and Human for another; then saves
  // Human and expects the seed's entry removed.
  // Criteria: SP-6.
  it('saves the species per seed and removes the entry for Human', () => {
    const storage = new MemoryStorage()
    expect(writeSavedSpecies(storage, 'one', 'sample-ursine')).toBe('saved')
    expect(readSavedSpecies(storage, 'one')).toBe('sample-ursine')
    expect(readSavedSpecies(storage, 'two')).toBe('human')
    writeSavedSpecies(storage, 'one', 'human')
    expect(storage.getItem(SPECIES_KEY)).toBe('{}')
  })

  // Saves species for the seeds "__proto__" and "constructor" and expects each read back; a seed with
  // nothing saved still reads Human.
  // Criteria: SP-13.
  it('reads and writes seeds named like object properties as plain keys', () => {
    const storage = new MemoryStorage()
    expect(readSavedSpecies(storage, '__proto__')).toBe('human')
    expect(readSavedSpecies(storage, 'constructor')).toBe('human')
    writeSavedSpecies(storage, '__proto__', 'sample-ursine')
    writeSavedSpecies(storage, 'constructor', 'sample-mite')
    expect(readSavedSpecies(storage, '__proto__')).toBe('sample-ursine')
    expect(readSavedSpecies(storage, 'constructor')).toBe('sample-mite')
    expect(readSavedSpecies(storage, 'toString')).toBe('human')
  })

  // Saves a map with one valid entry and one numeric entry, reads both seeds, then saves a species for a
  // third seed and expects all three entries in storage, the numeric one unchanged.
  // Criteria: SP-14.
  it('keeps the other entries when one saved entry is not a species id', () => {
    const storage = new MemoryStorage()
    storage.setItem(SPECIES_KEY, JSON.stringify({ good: 'sample-ursine', bad: 7 }))
    expect(readSavedSpecies(storage, 'good')).toBe('sample-ursine')
    expect(readSavedSpecies(storage, 'bad')).toBe('human')
    writeSavedSpecies(storage, 'new', 'sample-mite')
    expect(JSON.parse(storage.getItem(SPECIES_KEY) ?? '{}')).toEqual({ good: 'sample-ursine', bad: 7, new: 'sample-mite' })
  })

  // Reads with no storage, with text that is not JSON, and with a failing write, and expects Human,
  // Human, and "failed".
  it('reads Human when nothing valid is saved and reports a failed write', () => {
    expect(readSavedSpecies(undefined, 'one')).toBe('human')
    expect(writeSavedSpecies(undefined, 'one', 'x')).toBe('unavailable')
    const storage = new MemoryStorage()
    storage.setItem(SPECIES_KEY, 'not json')
    expect(readSavedSpecies(storage, 'one')).toBe('human')
    storage.failWrites = true
    expect(writeSavedSpecies(storage, 'one', 'x')).toBe('failed')
  })
})

// Tests that the career engine reads the species values through `base`.
describe('species and careers', () => {
  // Builds the start of the valid fixture's END qualification with base values from speciesBase for a
  // species with END +6, and expects the qualification DM to be the DM of the modified END.
  // Criteria: SP-12.
  it('uses the modified characteristic for the qualification DM', () => {
    const result = parseCareerPack(validPack)
    if (!result.ok) throw new Error(result.reason)
    const data: CareerData = { careers: result.careers, rules: sampleRules }
    const tough: SpeciesDefinition = { ...URSINE, modifiers: { END: 6 } }
    const chars = newCharacter('species-qualification').characteristics
    const base = speciesBase(chars, tough)
    expect(base.END).toBe(chars.END.rolled + 6)
    expect(characteristicDM(base.END)).not.toBe(characteristicDM(chars.END.rolled))
    const input = { ...EMPTY_INPUT, choices: { 'start.career': 'test-courier', 'start.assignment': 'debris-sweep' } }
    const built = buildCareer('species-qualification', base, input, data)
    expect(built.qualification?.dm).toBe(characteristicDM(base.END))
  })
})
