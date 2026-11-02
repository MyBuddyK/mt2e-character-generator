import { createDice, seedFromString } from './dice'
import { rollCharacteristics, type Characteristic, type Characteristics } from './characteristics'
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
 * Returns a copy of `character` with one characteristic's override set to `value`. Passing undefined
 * removes the override.
 */
export function overrideCharacteristic(
  character: Character,
  key: Characteristic,
  value: number | undefined,
): Character {
  return {
    ...character,
    characteristics: {
      ...character.characteristics,
      [key]: withOverride(character.characteristics[key], value),
    },
  }
}

/** Returns an 8-character base-36 string from Math.random(), for use as a new seed. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}
