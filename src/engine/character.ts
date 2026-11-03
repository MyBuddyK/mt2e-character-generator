import { createDice, seedFromString } from './dice'
import {
  normalizeCharacteristic,
  rollCharacteristics,
  type Characteristic,
  type Characteristics,
} from './characteristics'
import { withOverride } from './overridable'

/**
 * The character being built. It currently holds the seed, name and characteristics; career terms
 * are not modelled yet.
 */
export interface Character {
  seed: string
  name: string
  characteristics: Characteristics
}

/** Returns a new character whose characteristics are rolled from `seed`. */
export function newCharacter(seed: string): Character {
  const dice = createDice(seedFromString(seed))
  return {
    seed,
    name: '',
    characteristics: rollCharacteristics(dice),
  }
}

/**
 * Returns a copy of `character` with one characteristic's override set to `value`, rounded and
 * clamped by normalizeCharacteristic. Passing undefined or NaN removes the override. Setting the
 * override equal to the rolled value also removes it.
 */
export function overrideCharacteristic(
  character: Character,
  key: Characteristic,
  value: number | undefined,
): Character {
  const normalized = value === undefined ? undefined : normalizeCharacteristic(value)
  return {
    ...character,
    characteristics: {
      ...character.characteristics,
      [key]: withOverride(character.characteristics[key], normalized),
    },
  }
}

const SEED_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
/** Number of characters in a seed returned by randomSeed. */
export const SEED_LENGTH = 8

/**
 * Returns a new seed: SEED_LENGTH characters from 0-9 and a-z, picked with crypto.getRandomValues.
 * This is the only randomness outside dice.ts; it picks the seed, and dice.ts makes every roll.
 */
export function randomSeed(): string {
  const bytes = new Uint32Array(SEED_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => SEED_ALPHABET.charAt(b % SEED_ALPHABET.length)).join('')
}
