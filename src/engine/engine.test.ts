import { describe, expect, it } from 'vitest'
import { createDice, seedFromString } from './dice'
import { characteristicDM, MAX_CHARACTERISTIC, normalizeCharacteristic, toHex, upp } from './characteristics'
import { newCharacter, overrideCharacteristic, randomSeed, SEED_LENGTH } from './character'
import { current, isOverridden } from './overridable'
import { loadCareers, parseCareer } from './career-schema'
import { careerErrors, careers } from '../data/careers'
import sampleCareer from '../data/careers/sample-sanitation.json'
import { FAIR_USE_DISCLAIMER } from '../legal'
import readme from '../../README.md?raw'

/** Returns a deep copy of the sample career, for tests that break one field at a time. */
function sample(): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(sampleCareer)
  return copy
}

/** Returns the error messages parseCareer gives for `data`, or an empty array if it passes. */
function errorsFor(data: unknown): string[] {
  const result = parseCareer(data)
  return result.ok ? [] : result.errors
}

// Tests for the seeded dice in dice.ts.
describe('dice', () => {
  // Creates two Dice from seed 42, rolls 2D twenty times on each, and expects identical sequences.
  it('gives the same sequence for the same seed', () => {
    const a = createDice(42)
    const b = createDice(42)
    expect(Array.from({ length: 20 }, () => a.roll(2))).toEqual(Array.from({ length: 20 }, () => b.roll(2)))
  })

  // Rolls 2D twenty times from seeds 1 and 2 and expects the two sequences to differ.
  it('gives different sequences for different seeds', () => {
    const a = createDice(1)
    const b = createDice(2)
    expect(Array.from({ length: 20 }, () => a.roll(2))).not.toEqual(Array.from({ length: 20 }, () => b.roll(2)))
  })

  // Pins the first ten d6 rolls for seed 42, so a change to the generator shows up as a failure here.
  it('matches the recorded d6 sequence for seed 42', () => {
    const dice = createDice(42)
    expect(Array.from({ length: 10 }, () => dice.d6())).toEqual([4, 3, 6, 5, 2, 4, 2, 4, 6, 3])
  })

  // Rolls 6000 d6 and expects only the values 1 to 6, with every face appearing.
  it('rolls every d6 face and nothing else', () => {
    const dice = createDice(seedFromString('faces'))
    const seen = new Set(Array.from({ length: 6000 }, () => dice.d6()))
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  // Rolls 2D 6000 times and expects only the values 2 to 12, with every total appearing.
  it('rolls every 2D total from 2 to 12 and nothing else', () => {
    const dice = createDice(seedFromString('2d'))
    const seen = new Set(Array.from({ length: 6000 }, () => dice.roll(2)))
    expect([...seen].sort((x, y) => x - y)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  // Rolls D66 3600 times and expects only the 36 values 11-16, 21-26, ... 61-66, with every one appearing.
  it('rolls every D66 result and nothing else', () => {
    const dice = createDice(seedFromString('d66'))
    const seen = new Set(Array.from({ length: 3600 }, () => dice.d66()))
    const expected = [1, 2, 3, 4, 5, 6].flatMap((t) => [1, 2, 3, 4, 5, 6].map((u) => t * 10 + u))
    expect([...seen].sort((x, y) => x - y)).toEqual(expected)
  })

  // Calls roll with 2.5 and -1 and expects a RangeError each time; roll(0) returns 0.
  it('rejects dice counts that are not non-negative integers', () => {
    const dice = createDice(1)
    expect(() => dice.roll(2.5)).toThrow(RangeError)
    expect(() => dice.roll(-1)).toThrow(RangeError)
    expect(dice.roll(0)).toBe(0)
  })
})

// Tests for characteristic DMs, extended hex, UPP formatting and overrides.
describe('characteristics', () => {
  // Checks characteristicDM for every value from 0 to 16 against the MT2e DM table.
  it.each([
    [0, -3],
    [1, -2],
    [2, -2],
    [3, -1],
    [4, -1],
    [5, -1],
    [6, 0],
    [7, 0],
    [8, 0],
    [9, 1],
    [10, 1],
    [11, 1],
    [12, 2],
    [13, 2],
    [14, 2],
    [15, 3],
    [16, 3],
  ])('value %i has DM %i', (value, dm) => {
    expect(characteristicDM(value)).toBe(dm)
  })

  // Checks toHex for digits, letters around the skipped I and O, both ends of the range, and
  // out-of-range or fractional input.
  it.each([
    [0, '0'],
    [9, '9'],
    [10, 'A'],
    [15, 'F'],
    [17, 'H'],
    [18, 'J'],
    [22, 'N'],
    [23, 'P'],
    [33, 'Z'],
    [34, 'Z'],
    [99, 'Z'],
    [-1, '0'],
    [7.5, '8'],
    [Number.NaN, '0'],
  ])('toHex(%d) is %s', (value, digit) => {
    expect(toHex(value)).toBe(digit)
  })

  // Checks that normalizeCharacteristic rounds, clamps to 0..33, and returns undefined for NaN and Infinity.
  it('normalizes override values', () => {
    expect(normalizeCharacteristic(7.4)).toBe(7)
    expect(normalizeCharacteristic(-5)).toBe(0)
    expect(normalizeCharacteristic(99)).toBe(MAX_CHARACTERISTIC)
    expect(normalizeCharacteristic(Number.NaN)).toBeUndefined()
    expect(normalizeCharacteristic(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  // Rolls a character from seed "abc" and expects the UPP to be six extended-hex digits.
  it('writes the UPP as six extended-hex digits', () => {
    expect(upp(newCharacter('abc').characteristics)).toMatch(/^[0-9A-HJ-NP-Z]{6}$/)
  })

  // Overrides STR to a value different from the roll, and expects the override to be current while
  // the rolled value stays unchanged.
  it('keeps the rolled value when overridden', () => {
    const c = newCharacter('override')
    const rolledStr = c.characteristics.STR.rolled
    const target = rolledStr === 12 ? 11 : 12
    const changed = overrideCharacteristic(c, 'STR', target)
    expect(current(changed.characteristics.STR)).toBe(target)
    expect(changed.characteristics.STR.rolled).toBe(rolledStr)
    expect(isOverridden(changed.characteristics.STR)).toBe(true)
  })

  // Overrides STR, then clears it with undefined, and expects no override and the rolled value current.
  it('clears an override', () => {
    const c = newCharacter('override')
    const rolledStr = c.characteristics.STR.rolled
    const cleared = overrideCharacteristic(overrideCharacteristic(c, 'STR', 3), 'STR', undefined)
    expect(isOverridden(cleared.characteristics.STR)).toBe(false)
    expect(current(cleared.characteristics.STR)).toBe(rolledStr)
  })

  // Overrides STR to its own rolled value and expects no override to be stored.
  it('drops an override equal to the rolled value', () => {
    const c = newCharacter('override')
    const same = overrideCharacteristic(c, 'STR', c.characteristics.STR.rolled)
    expect(same.characteristics.STR.override).toBeUndefined()
  })

  // Overrides with 99, 7.6 and NaN and expects 33, 8, and no override.
  it('rounds and clamps override values', () => {
    const c = newCharacter('override')
    expect(current(overrideCharacteristic(c, 'DEX', 99).characteristics.DEX)).toBe(33)
    expect(current(overrideCharacteristic(c, 'DEX', 7.6).characteristics.DEX)).toBe(8)
    expect(overrideCharacteristic(c, 'DEX', Number.NaN).characteristics.DEX.override).toBeUndefined()
  })

  // Calls randomSeed 1000 times and expects each result to be SEED_LENGTH characters from 0-9 and a-z.
  it('makes seeds of a fixed length', () => {
    for (let i = 0; i < 1000; i++) expect(randomSeed()).toMatch(new RegExp(`^[0-9a-z]{${SEED_LENGTH}}$`))
  })
})

// Tests for CareerSchema, parseCareer and loadCareers.
describe('career data', () => {
  // Expects every JSON file in src/data/careers to pass, and at least one career to be loaded.
  it('loads every career file in the repo without errors', () => {
    expect(careerErrors).toEqual([])
    expect(careers.length).toBeGreaterThan(0)
  })

  // Parses an object with only an id and expects messages naming the missing name and events fields.
  it('reports missing fields', () => {
    const errors = errorsFor({ id: 'x' })
    expect(errors).toContainEqual(expect.stringMatching(/^name: /))
    expect(errors).toContainEqual(expect.stringMatching(/^events: /))
  })

  // Sets every event roll to 99 and expects a message saying event rolls must cover 2 to 12.
  it('reports event rolls that do not cover 2 to 12', () => {
    const data = sample()
    data['events'] = sampleCareer.events.map((e) => ({ ...e, roll: 99 }))
    expect(errorsFor(data)).toContainEqual(expect.stringMatching(/^events: roll values must be 2 to 12/))
  })

  // Sets every mishap roll to 1 and expects a message saying mishap rolls must cover 1 to 6.
  it('reports mishap rolls that do not cover 1 to 6', () => {
    const data = sample()
    data['mishaps'] = sampleCareer.mishaps.map((e) => ({ ...e, roll: 1 }))
    expect(errorsFor(data)).toContainEqual(expect.stringMatching(/^mishaps: roll values must be 1 to 6/))
  })

  // Replaces the mustering-out table with one empty row and expects messages for its fields and rolls.
  it('reports malformed mustering-out rows', () => {
    const data = sample()
    data['musteringOut'] = [{}]
    const errors = errorsFor(data)
    expect(errors).toContainEqual(expect.stringMatching(/^musteringOut\.0\.cash: /))
    expect(errors).toContainEqual(expect.stringMatching(/^musteringOut\.0\.benefit: /))
  })

  // Replaces the sample's assignments with two copies of its first assignment and expects a duplicate id
  // message naming that id.
  it('reports duplicate assignment ids', () => {
    const data = sample()
    const [first] = sampleCareer.assignments
    data['assignments'] = [first, first]
    expect(errorsFor(data)).toContainEqual('assignments: duplicate id "debris-sweep"')
  })

  // Replaces the assignments with [null] and expects an error message instead of a thrown exception.
  it('reports a null assignment without throwing', () => {
    const data = sample()
    data['assignments'] = [null]
    expect(() => parseCareer(data)).not.toThrow()
    expect(errorsFor(data)).toContainEqual(expect.stringMatching(/^assignments\.0: /))
  })

  // Removes the ranks from the first assignment and expects a message for that field.
  it('reports missing ranks', () => {
    const data = sample()
    data['assignments'] = sampleCareer.assignments.map((a, i) => {
      if (i !== 0) return a
      const { ranks: _ranks, ...withoutRanks } = a
      return withoutRanks
    })
    expect(errorsFor(data)).toContainEqual(expect.stringMatching(/^assignments\.0\.ranks: /))
  })

  // Sets id to a number, empties a skill entry and sets a target of 1e9, and expects a message for each.
  it('reports wrong types, empty skills and out-of-range targets', () => {
    const data = sample()
    data['id'] = 5
    data['qualification'] = { characteristic: 'INT', target: 1e9 }
    data['skillTables'] = { ...sampleCareer.skillTables, serviceSkills: ['', 'a', 'b', 'c', 'd', 'e'] }
    const errors = errorsFor(data)
    expect(errors).toContainEqual(expect.stringMatching(/^id: /))
    expect(errors).toContainEqual(expect.stringMatching(/^qualification\.target: /))
    expect(errors).toContainEqual(expect.stringMatching(/^skillTables\.serviceSkills\.0: /))
  })

  // Loads two files with the same career id and expects the second to be left out and reported.
  it('reports careers with the same id in different files', () => {
    const result = loadCareers({ './a.json': sampleCareer, './b.json': sampleCareer })
    expect(result.careers).toHaveLength(1)
    expect(result.errors).toEqual(['./b.json: id "sample-sanitation" is already used by ./a.json'])
  })

  // Loads one valid file and one without a name, and expects the valid one loaded and the other reported.
  it('keeps loading when one file is invalid', () => {
    const broken = sample()
    delete broken['name']
    const result = loadCareers({ './good.json': sampleCareer, './broken.json': broken })
    expect(result.careers.map((c) => c.id)).toEqual(['sample-sanitation'])
    expect(result.errors).toContainEqual(expect.stringMatching(/^\.\/broken\.json: name: /))
  })
})

// Tests for the Fair Use disclaimer in src/legal.ts.
describe('legal notice', () => {
  // Imports README.md as text and expects it to contain the same disclaimer text the app shows.
  it('README carries the same Fair Use disclaimer as the app', () => {
    expect(readme).toContain(FAIR_USE_DISCLAIMER)
  })
})
