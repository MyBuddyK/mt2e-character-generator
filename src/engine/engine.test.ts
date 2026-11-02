import { describe, expect, it } from 'vitest'
import { createDice, seedFromString } from './dice'
import { characteristicDM, toHex, upp } from './characteristics'
import { newCharacter, overrideCharacteristic } from './character'
import { current, isOverridden } from './overridable'
import { validateCareer } from './career-schema'
import { careers } from '../data/careers'

describe('dice', () => {
  it('is reproducible from a seed', () => {
    const a = createDice(42)
    const b = createDice(42)
    const rollsA = Array.from({ length: 20 }, () => a.roll(2))
    const rollsB = Array.from({ length: 20 }, () => b.roll(2))
    expect(rollsA).toEqual(rollsB)
  })

  it('stays within range', () => {
    const dice = createDice(seedFromString('range'))
    for (let i = 0; i < 1000; i++) {
      const d6 = dice.d6()
      expect(d6).toBeGreaterThanOrEqual(1)
      expect(d6).toBeLessThanOrEqual(6)
      const d66 = dice.d66()
      expect(Math.floor(d66 / 10)).toBeGreaterThanOrEqual(1)
      expect(d66 % 10).toBeLessThanOrEqual(6)
    }
  })
})

describe('characteristics', () => {
  it.each([
    [0, -3],
    [2, -2],
    [5, -1],
    [6, 0],
    [8, 0],
    [9, 1],
    [12, 2],
    [15, 3],
  ])('value %i has DM %i', (value, dm) => {
    expect(characteristicDM(value)).toBe(dm)
  })

  it('writes UPP values as hex', () => {
    expect(toHex(9)).toBe('9')
    expect(toHex(10)).toBe('A')
    expect(toHex(15)).toBe('F')
    expect(upp(newCharacter('abc').characteristics)).toMatch(/^[0-9A-F]{6}$/)
  })

  it('keeps the rolled value when overridden', () => {
    const c = newCharacter('override')
    const rolledStr = c.characteristics.STR.rolled
    const changed = overrideCharacteristic(c, 'STR', 15)
    expect(current(changed.characteristics.STR)).toBe(15)
    expect(changed.characteristics.STR.rolled).toBe(rolledStr)
    expect(isOverridden(changed.characteristics.STR)).toBe(rolledStr !== 15)
    const cleared = overrideCharacteristic(changed, 'STR', undefined)
    expect(isOverridden(cleared.characteristics.STR)).toBe(false)
  })
})

describe('career data', () => {
  it('loads at least one career', () => {
    expect(careers.length).toBeGreaterThan(0)
  })

  it.each(careers.map((c) => [c.id, c] as const))('%s passes validation', (_id, career) => {
    expect(validateCareer(career)).toEqual([])
  })

  it('reports problems in a broken career', () => {
    expect(validateCareer({ id: 'x' })).not.toEqual([])
  })
})
