/**
 * Seeded dice. The generator makes every roll through a Dice instance, so two Dice created from
 * the same seed return the same sequence of rolls.
 */

/** A function that returns a number in the range [0, 1). */
export type Rng = () => number

/**
 * Returns a mulberry32 pseudo-random generator for the given 32-bit seed. Each call returns the
 * next number in the range [0, 1). The same seed always produces the same sequence.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Converts a string, such as the URL's ?seed= value, to a 32-bit seed using the FNV-1a hash. */
export function seedFromString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Dice rolling functions backed by one seeded generator. */
export interface Dice {
  /** Returns one six-sided die roll, from 1 to 6. */
  d6(): number
  /** Returns the sum of `count` six-sided dice. Throws a RangeError if `count` is not a non-negative integer. */
  roll(count: number): number
  /** Returns a D66 roll: the first die as the tens digit and the second as the units (11 to 66). */
  d66(): number
}

/** Returns a Dice instance whose rolls come from a generator seeded with `seed`. */
export function createDice(seed: number): Dice {
  const rng = createRng(seed)
  const d6 = () => Math.floor(rng() * 6) + 1
  return {
    d6,
    roll(count) {
      if (!Number.isInteger(count) || count < 0) throw new RangeError(`dice count must be a non-negative integer, got ${count}`)
      let total = 0
      for (let i = 0; i < count; i++) total += d6()
      return total
    },
    d66() {
      return d6() * 10 + d6()
    },
  }
}
