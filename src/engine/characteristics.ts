import type { Dice } from './dice'
import { current, rolled, type Overridable } from './overridable'

export const CHARACTERISTICS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'] as const
export type Characteristic = (typeof CHARACTERISTICS)[number]

export type Characteristics = Record<Characteristic, Overridable<number>>

/** Characteristic dice modifier. */
export function characteristicDM(value: number): number {
  if (value <= 0) return -3
  if (value <= 2) return -2
  if (value <= 5) return -1
  if (value <= 8) return 0
  if (value <= 11) return 1
  if (value <= 14) return 2
  return 3
}

/** Rolls 2D for each characteristic, in order. */
export function rollCharacteristics(dice: Dice): Characteristics {
  const result = {} as Characteristics
  for (const c of CHARACTERISTICS) result[c] = rolled(dice.roll(2))
  return result
}

/** Traveller-style hex digit (0-9, then A, B, C...). Used for the UPP string. */
export function toHex(value: number): string {
  if (value < 0) return '0'
  return value < 10 ? String(value) : String.fromCharCode(55 + value)
}

/** Universal Personality Profile, e.g. "7A86B5". */
export function upp(chars: Characteristics): string {
  return CHARACTERISTICS.map((c) => toHex(current(chars[c]))).join('')
}
