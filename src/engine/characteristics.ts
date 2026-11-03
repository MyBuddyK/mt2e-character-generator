import type { Dice } from './dice'
import { current, rolled, type Overridable } from './overridable'

/** The six characteristics, in UPP order. */
export const CHARACTERISTICS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'] as const
/** One of the six characteristic codes. */
export type Characteristic = (typeof CHARACTERISTICS)[number]

/** A character's six characteristics, each with its rolled value and optional override. */
export type Characteristics = Record<Characteristic, Overridable<number>>

/** Lowest characteristic value the generator stores. */
export const MIN_CHARACTERISTIC = 0
/** Highest characteristic value the generator stores: 33, the largest single extended-hex digit (Z). */
export const MAX_CHARACTERISTIC = 33

/**
 * Traveller extended hex digits, indexed by value from 0 to 33. The letters I and O are left out so
 * they can't be mistaken for 1 and 0.
 */
const EHEX_DIGITS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * Returns `value` rounded to the nearest integer and clamped to MIN_CHARACTERISTIC..MAX_CHARACTERISTIC.
 * Returns undefined for NaN or infinite input.
 */
export function normalizeCharacteristic(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.min(MAX_CHARACTERISTIC, Math.max(MIN_CHARACTERISTIC, Math.round(value)))
}

/** Returns the dice modifier for a characteristic value: -3 at 0, rising to +3 at 15 or more. */
export function characteristicDM(value: number): number {
  if (value <= 0) return -3
  if (value <= 2) return -2
  if (value <= 5) return -1
  if (value <= 8) return 0
  if (value <= 11) return 1
  if (value <= 14) return 2
  return 3
}

/** Rolls 2D for each characteristic, in the order STR, DEX, END, INT, EDU, SOC. */
export function rollCharacteristics(dice: Dice): Characteristics {
  const STR = rolled(dice.roll(2))
  const DEX = rolled(dice.roll(2))
  const END = rolled(dice.roll(2))
  const INT = rolled(dice.roll(2))
  const EDU = rolled(dice.roll(2))
  const SOC = rolled(dice.roll(2))
  return { STR, DEX, END, INT, EDU, SOC }
}

/**
 * Returns `value` as one extended-hex digit (0-9, then A-H, J-N, P-Z, which covers 0 to 33). The value
 * is first rounded and clamped with normalizeCharacteristic; NaN returns '0'.
 */
export function toHex(value: number): string {
  const n = normalizeCharacteristic(value) ?? MIN_CHARACTERISTIC
  return EHEX_DIGITS.charAt(n)
}

/** Returns the Universal Personality Profile: the six current characteristic values as hex digits, e.g. "7A86B5". */
export function upp(chars: Characteristics): string {
  return CHARACTERISTICS.map((c) => toHex(current(chars[c]))).join('')
}
