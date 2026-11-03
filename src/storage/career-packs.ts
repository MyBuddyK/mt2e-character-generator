import { z } from 'zod'

/**
 * Saves imported career packs in the browser's localStorage. Nothing here sends a pack anywhere.
 * Every storage call is wrapped in try/catch, because browsers can block or limit storage.
 */

/** The localStorage key that holds every saved pack, as one JSON array. */
export const STORAGE_KEY = 'mt2e.careerPacks.v1'

/** Where a pack came from: a file the player picked, or an https URL the app downloaded. */
export const PackOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), fileName: z.string() }),
  z.object({ kind: z.literal('url'), url: z.string() }),
])
/** A pack's origin, as described by PackOriginSchema. */
export type PackOrigin = z.infer<typeof PackOriginSchema>

/**
 * One saved pack: the pack JSON as imported (not yet checked by parseCareerPack), its fingerprint,
 * the ISO time it was imported, and its origin.
 */
export const StoredPackSchema = z.object({
  data: z.unknown(),
  fingerprint: z.string(),
  importedAt: z.string(),
  origin: PackOriginSchema,
})
/** One saved pack, as described by StoredPackSchema. */
export type StoredPack = z.infer<typeof StoredPackSchema>

/**
 * Returns window.localStorage when it can be read and written, or undefined when it is missing or
 * any access throws (for example in some private browsing modes or with site data blocked). Writes
 * and removes a probe key under STORAGE_KEY + ".probe" to test this.
 */
export function browserStorage(): Storage | undefined {
  try {
    const storage = window.localStorage
    const probe = `${STORAGE_KEY}.probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return undefined
  }
}

/** The result of readStoredPacks: the saved packs, and how many saved entries had an unknown shape and were left out. */
export interface ReadResult {
  packs: StoredPack[]
  unreadable: number
}

/**
 * Reads the saved packs from `storage`. Returns no packs when `storage` is undefined, nothing is
 * saved, the value is not a JSON array, or reading throws. Array entries that don't match
 * StoredPackSchema are left out and counted in `unreadable`; a value that is not an array counts as
 * one unreadable entry.
 */
export function readStoredPacks(storage: Storage | undefined): ReadResult {
  if (!storage) return { packs: [], unreadable: 0 }
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    return { packs: [], unreadable: 0 }
  }
  if (text === null) return { packs: [], unreadable: 0 }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { packs: [], unreadable: 1 }
  }
  if (!Array.isArray(value)) return { packs: [], unreadable: 1 }
  const packs: StoredPack[] = []
  let unreadable = 0
  for (const entry of value) {
    const result = StoredPackSchema.safeParse(entry)
    if (result.success) packs.push(result.data)
    else unreadable += 1
  }
  return { packs, unreadable }
}

/**
 * The result of writeStoredPacks: "saved", "unavailable" when `storage` is undefined, or "failed"
 * when the write threw (for example QuotaExceededError). After "failed", the value saved before the
 * call is unchanged, because setItem either stores the whole value or throws.
 */
export type WriteResult = 'saved' | 'unavailable' | 'failed'

/**
 * Saves `packs` to `storage` under STORAGE_KEY, replacing what was saved. Removes the key when
 * `packs` is empty. Returns how the write went; it does not throw.
 */
export function writeStoredPacks(storage: Storage | undefined, packs: StoredPack[]): WriteResult {
  if (!storage) return 'unavailable'
  try {
    if (packs.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(packs))
    return 'saved'
  } catch {
    return 'failed'
  }
}
