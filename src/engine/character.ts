import { createDice, seedFromString } from './dice'
import { rollCharacteristics, type Characteristic, type Characteristics } from './characteristics'
import { withOverride } from './overridable'

/**
 * The character being built. For now this covers characteristics only; the
 * career loop (terms, events, mustering out) is added in step 2 of the plan.
 */
export interface Character {
  seed: string
  name: string
  characteristics: Characteristics
}

export function newCharacter(seed: string): Character {
  const dice = createDice(seedFromString(seed))
  return {
    seed,
    name: '',
    characteristics: rollCharacteristics(dice),
  }
}

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

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}
