import { z } from 'zod'
import { HUMAN } from '../engine/species'
import type { WriteResult } from './career-packs'

/**
 * Saves the species picked for each seed in localStorage (docs/features/species.md, decision 6). Every
 * storage call is wrapped in try/catch.
 */

/** The localStorage key that holds the picked species, as one JSON object from seed to species id. */
export const SPECIES_KEY = 'mt2e.species.v1'

const SavedSpeciesSchema = z.record(z.string(), z.string())

/** Reads the whole seed-to-species map, or an empty object when there is none or it can't be read. */
function readAll(storage: Storage): Record<string, string> {
  try {
    const text = storage.getItem(SPECIES_KEY)
    if (text === null) return {}
    const result = SavedSpeciesSchema.safeParse(JSON.parse(text))
    return result.success ? { ...result.data } : {}
  } catch {
    return {}
  }
}

/**
 * Returns the species id saved for `seed`, or HUMAN's id when `storage` is undefined or nothing valid is
 * saved for that seed. Does not throw.
 */
export function readSavedSpecies(storage: Storage | undefined, seed: string): string {
  if (!storage) return HUMAN.id
  return readAll(storage)[seed] ?? HUMAN.id
}

/**
 * Saves `speciesId` for `seed`, or removes the seed's entry when it is HUMAN's id, keeping every other
 * seed's entry. Returns how the write went; it does not throw.
 */
export function writeSavedSpecies(storage: Storage | undefined, seed: string, speciesId: string): WriteResult {
  if (!storage) return 'unavailable'
  const all = readAll(storage)
  if (speciesId === HUMAN.id) delete all[seed]
  else all[seed] = speciesId
  try {
    storage.setItem(SPECIES_KEY, JSON.stringify(all))
    return 'saved'
  } catch {
    return 'failed'
  }
}
