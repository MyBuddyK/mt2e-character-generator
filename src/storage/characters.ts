import { z } from 'zod'
import type { CareerInput } from '../engine/terms'
import type { WriteResult } from './career-packs'

/**
 * Saves each character's career choices, overrides and notes in localStorage, keyed by seed,
 * together with the ?packs= value they were made with. Every storage call is wrapped in try/catch.
 */

/** The localStorage key that holds every saved character, as one JSON object keyed by seed. */
export const CHARACTERS_KEY = 'mt2e.characters.v1'

const InputSchema = z.object({
  choices: z.record(z.string(), z.string()),
  rolls: z.record(z.string(), z.number()),
  outcomes: z.record(z.string(), z.enum(['pass', 'fail'])),
  notes: z.record(z.string(), z.string()),
})

/** One saved character: the ?packs= value (empty for the bundled careers) and the career input. */
export const SavedCharacterSchema = z.object({ packs: z.string(), input: InputSchema })
/** One saved character, as described by SavedCharacterSchema. */
export type SavedCharacter = { packs: string; input: CareerInput }

/**
 * Reads every saved character entry as raw JSON [seed, value] pairs, or no entries when there is none or
 * it can't be read. Pairs are used instead of an object so that seeds such as "__proto__" are plain keys.
 */
function readEntries(storage: Storage): [string, unknown][] {
  try {
    const text = storage.getItem(CHARACTERS_KEY)
    if (text === null) return []
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value) : []
  } catch {
    return []
  }
}

/**
 * Returns the saved character for `seed`, or undefined when `storage` is undefined, nothing is
 * saved for that seed, or the saved value doesn't match SavedCharacterSchema. Does not throw.
 */
export function readSavedCharacter(storage: Storage | undefined, seed: string): SavedCharacter | undefined {
  if (!storage) return undefined
  const result = SavedCharacterSchema.safeParse(readEntries(storage).find(([key]) => key === seed)?.[1])
  return result.success ? result.data : undefined
}

/**
 * Saves `character` for `seed`, or removes the entry when `character` is undefined, keeping every
 * other seed's entry as it was. Returns how the write went; it does not throw.
 */
export function writeSavedCharacter(
  storage: Storage | undefined,
  seed: string,
  character: SavedCharacter | undefined,
): WriteResult {
  if (!storage) return 'unavailable'
  const entries: [string, unknown][] = readEntries(storage).filter(([key]) => key !== seed)
  if (character !== undefined) entries.push([seed, character])
  try {
    storage.setItem(CHARACTERS_KEY, JSON.stringify(Object.fromEntries(entries)))
    return 'saved'
  } catch {
    return 'failed'
  }
}
