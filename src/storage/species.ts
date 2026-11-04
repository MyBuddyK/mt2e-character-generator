import { HUMAN } from '../engine/species'
import type { WriteResult } from './career-packs'

/**
 * Saves the species picked for each seed in localStorage (docs/features/species.md, decision 6). Every
 * storage call is wrapped in try/catch.
 */

/** The localStorage key that holds the picked species, as one JSON object from seed to species id. */
export const SPECIES_KEY = 'mt2e.species.v1'

/**
 * Reads the saved seed-to-species object as raw JSON entries, so an entry that isn't a string is kept
 * as it was and doesn't hide the others. Returns no entries when nothing is saved, the text isn't JSON,
 * or the value isn't a plain object.
 */
function readEntries(storage: Storage): [string, unknown][] {
  try {
    const text = storage.getItem(SPECIES_KEY)
    if (text === null) return []
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value) : []
  } catch {
    return []
  }
}

/**
 * Returns the species id saved for `seed`, or HUMAN's id when `storage` is undefined or the seed's own
 * entry is missing or not a non-empty string. Seeds such as "__proto__" and "constructor" are read as
 * keys like any other. Does not throw.
 */
export function readSavedSpecies(storage: Storage | undefined, seed: string): string {
  if (!storage) return HUMAN.id
  const entry = readEntries(storage).find(([key]) => key === seed)
  const value = entry?.[1]
  return typeof value === 'string' && value !== '' ? value : HUMAN.id
}

/**
 * Saves `speciesId` for `seed`, or removes the seed's entry when it is HUMAN's id, keeping every other
 * seed's entry as it was, including entries that aren't valid. Returns how the write went; it does not
 * throw.
 */
export function writeSavedSpecies(storage: Storage | undefined, seed: string, speciesId: string): WriteResult {
  if (!storage) return 'unavailable'
  const entries = readEntries(storage).filter(([key]) => key !== seed)
  if (speciesId !== HUMAN.id) entries.push([seed, speciesId])
  try {
    storage.setItem(SPECIES_KEY, JSON.stringify(Object.fromEntries(entries)))
    return 'saved'
  } catch {
    return 'failed'
  }
}
