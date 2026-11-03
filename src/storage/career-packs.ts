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

/**
 * The result of readStoredPacks: the saved packs, and the saved values that don't match
 * StoredPackSchema. The app passes `unreadable` back to writeStoredPacks so they are kept until the
 * player discards them.
 */
export interface ReadResult {
  packs: StoredPack[]
  unreadable: unknown[]
}

/**
 * Reads the saved packs from `storage`. Returns nothing when `storage` is undefined, nothing is
 * saved, or reading throws. Array entries that don't match StoredPackSchema go into `unreadable`.
 * When the saved text is not JSON, the text itself is the one unreadable entry; when it is JSON but
 * not an array, the parsed value is.
 */
export function readStoredPacks(storage: Storage | undefined): ReadResult {
  if (!storage) return { packs: [], unreadable: [] }
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    return { packs: [], unreadable: [] }
  }
  if (text === null) return { packs: [], unreadable: [] }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { packs: [], unreadable: [text] }
  }
  if (!Array.isArray(value)) return { packs: [], unreadable: [value] }
  const packs: StoredPack[] = []
  const unreadable: unknown[] = []
  for (const entry of value) {
    const result = StoredPackSchema.safeParse(entry)
    if (result.success) packs.push(result.data)
    else unreadable.push(entry)
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
 * Saves `packs` followed by `unreadable` (values readStoredPacks could not read, kept as they are)
 * to `storage` under STORAGE_KEY as one JSON array, replacing what was saved. Removes the key when
 * both are empty. Returns how the write went; it does not throw.
 */
export function writeStoredPacks(
  storage: Storage | undefined,
  packs: StoredPack[],
  unreadable: unknown[] = [],
): WriteResult {
  if (!storage) return 'unavailable'
  try {
    const entries: unknown[] = [...packs, ...unreadable]
    if (entries.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(entries))
    return 'saved'
  } catch {
    return 'failed'
  }
}
