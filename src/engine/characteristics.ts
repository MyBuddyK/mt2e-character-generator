import type { Dice } from './dice'
import { current, rolled, type Overridable } from './overridable'

/** The six characteristics, in UPP order. */
export const CHARACTERISTICS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'] as const
/** One of the six characteristic codes. */
export type Characteristic = (typeof CHARACTERISTICS)[number]

/** A character's six characteristics, each with its rolled value and optional override. */
export type Characteristics = Record<Characteristic, Overridable<number>>

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

/** Rolls 2D for each characteristic in the order STR, DEX, END, INT, EDU, SOC. */
export function rollCharacteristics(dice: Dice): Characteristics {
  const result = {} as Characteristics
  for (const c of CHARACTERISTICS) result[c] = rolled(dice.roll(2))
  return result
}

/** Returns a value as one extended-hex digit: 0 to 9, then A for 10, B for 11, and so on. Negative values return '0'. */
export function toHex(value: number): string {
  if (value < 0) return '0'
  return value < 10 ? String(value) : String.fromCharCode(55 + value)
}

/** Returns the Universal Personality Profile: the six current characteristic values as hex digits, e.g. "7A86B5". */
export function upp(chars: Characteristics): string {
  return CHARACTERISTICS.map((c) => toHex(current(chars[c]))).join('')
}
