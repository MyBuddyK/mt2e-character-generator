/**
 * Seeded dice. Every roll in the generator goes through a Dice instance so a
 * character can be reproduced exactly from its seed (useful for sharing and
 * for deterministic tests).
 */

export type Rng = () => number

/** mulberry32: small, fast, good enough for tabletop dice. Returns [0, 1). */
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

/** Turns any string (e.g. a URL ?seed=) into a 32-bit seed. */
export function seedFromString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface Dice {
  /** One six-sided die. */
  d6(): number
  /** Sum of `count` six-sided dice (2D is the standard Traveller roll). */
  roll(count: number): number
  /** D66: two dice read as tens and units (11 to 66). */
  d66(): number
}

export function createDice(seed: number): Dice {
  const rng = createRng(seed)
  const d6 = () => Math.floor(rng() * 6) + 1
  return {
    d6,
    roll(count) {
      let total = 0
      for (let i = 0; i < count; i++) total += d6()
      return total
    },
    d66() {
      return d6() * 10 + d6()
    },
  }
}
