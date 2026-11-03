import { useMemo, useRef, useState } from 'react'
import {
  combineCareers,
  formatPackRefs,
  packFingerprint,
  parseCareerPack,
  type PackInfo,
} from './engine/career-pack'
import type { CareerDefinition } from './engine/career-schema'
import {
  browserStorage,
  readStoredPacks,
  writeStoredPacks,
  type PackOrigin,
  type StoredPack,
} from './storage/career-packs'
import { describeFetchError, fetchCareerPack } from './storage/fetch-pack'

/** One saved pack that passed parseCareerPack, with its careers and any skipped-career messages. */
export interface PackEntry {
  stored: StoredPack
  pack: PackInfo
  careers: CareerDefinition[]
  problems: string[]
}

/** One saved pack that no longer passes parseCareerPack, with the reason, so the player can remove it. */
export interface BrokenPack {
  stored: StoredPack
  reason: string
}

/** A message from the last import, update check or removal. "error" messages are shown as alerts. */
export interface PackMessage {
  kind: 'error' | 'info'
  text: string
  details: string[]
}

/** What useCareerPacks returns to the UI. */
export interface CareerPacks {
  /** The saved packs that passed parseCareerPack, in import order. */
  entries: PackEntry[]
  /** The saved packs that fail parseCareerPack, for example after a format change. */
  broken: BrokenPack[]
  /** The careers to list: the bundled careers when no pack is loaded, otherwise the packs' careers. */
  careers: CareerDefinition[]
  /** Duplicate career id messages from combineCareers. */
  duplicates: string[]
  /** How many saved values could not be read at all. They are kept in storage until discarded. */
  unreadableCount: number
  /** False when the browser does not allow this site to use localStorage. */
  storageAvailable: boolean
  /** Names of packs that are loaded but whose last save failed. */
  unsaved: string[]
  /** The last message to show, or undefined. */
  message: PackMessage | undefined
  /** True while a URL request is running. */
  busy: boolean
  /** The ?packs= value for the loaded packs (see formatPackRefs). */
  packsParam: string
  /** Parses `text` as JSON and imports it as a pack picked from the file `fileName`. */
  importFile: (fileName: string, text: string) => Promise<void>
  /** Downloads `url` with fetchCareerPack and imports the result. */
  importUrl: (url: string) => Promise<void>
  /** Downloads a URL pack again and offers to replace it when its fingerprint has changed. */
  checkForUpdate: (entry: PackEntry) => Promise<void>
  /** Removes a saved pack (valid or broken) and saves the remaining ones. `name` is used in messages. */
  remove: (stored: StoredPack, name: string) => void
  /** Deletes the saved values that could not be read. */
  discardUnreadable: () => void
}

/** The loaded and incoming sides of a replacement, as shown in replaceQuestion. */
export interface ReplaceSide {
  id: string
  revision: number
  fingerprint: string
}

/**
 * Returns the text of the confirmation shown before a pack replaces a loaded pack. It names both
 * revisions and fingerprints. It adds a line when the content changed but the new revision is not
 * higher than the loaded one, and a line when the pack id changes.
 */
export function replaceQuestion(name: string, loaded: ReplaceSide, incoming: ReplaceSide): string {
  const lines = [
    `Replace the career pack "${name}"?`,
    `Loaded: revision ${loaded.revision} (fingerprint ${loaded.fingerprint})`,
    `New: revision ${incoming.revision} (fingerprint ${incoming.fingerprint})`,
  ]
  if (incoming.fingerprint !== loaded.fingerprint && incoming.revision <= loaded.revision) {
    lines.push('The content changed but the revision was not raised. The referee may have forgotten to raise it.')
  }
  if (incoming.id !== loaded.id) lines.push(`The pack id changes from "${loaded.id}" to "${incoming.id}".`)
  return lines.join('\n')
}

/** Splits saved packs into the ones that pass parseCareerPack and the ones that don't. */
function describePacks(stored: StoredPack[]): { entries: PackEntry[]; broken: BrokenPack[] } {
  const entries: PackEntry[] = []
  const broken: BrokenPack[] = []
  for (const s of stored) {
    const result = parseCareerPack(s.data)
    if (result.ok) entries.push({ stored: s, pack: result.pack, careers: result.careers, problems: result.problems })
    else broken.push({ stored: s, reason: result.reason })
  }
  return { entries, broken }
}

/**
 * React hook that holds the imported career packs. It reads the saved packs from localStorage once
 * on first render, and after each import, replacement or removal it writes them back with
 * writeStoredPacks, together with any saved values it could not read. Each change starts from the
 * packs as they are when the change is applied, not when the request that led to it began, so a
 * slow download doesn't undo an import or removal made while it ran. Replacing a loaded pack asks
 * for confirmation with window.confirm. `bundled` is the list of careers built into the app; it is
 * shown only while no pack is loaded.
 */
export function useCareerPacks(bundled: CareerDefinition[]): CareerPacks {
  const [storage] = useState(() => browserStorage())
  const [initial] = useState(() => readStoredPacks(storage))
  const [stored, setStored] = useState<StoredPack[]>(initial.packs)
  const [unreadable, setUnreadable] = useState<unknown[]>(initial.unreadable)
  const storedRef = useRef(stored)
  const unreadableRef = useRef(unreadable)
  const [unsaved, setUnsaved] = useState<string[]>([])
  const [message, setMessage] = useState<PackMessage | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const derived = useMemo(() => {
    const { entries, broken } = describePacks(stored)
    const combined = combineCareers(
      bundled,
      entries.map((e) => ({ id: e.pack.id, name: e.pack.name, careers: e.careers })),
    )
    const packsParam = formatPackRefs(entries.map((e) => ({ id: e.pack.id, fingerprint: e.stored.fingerprint })))
    return { entries, broken, combined, packsParam }
  }, [stored, bundled])

  /** Applies new saved packs and unreadable values to state and storage, and returns the write result. */
  const commit = (nextStored: StoredPack[], nextUnreadable: unknown[]) => {
    storedRef.current = nextStored
    unreadableRef.current = nextUnreadable
    setStored(nextStored)
    setUnreadable(nextUnreadable)
    const result = writeStoredPacks(storage, nextStored, nextUnreadable)
    if (result === 'saved') setUnsaved([])
    return result
  }

  /**
   * Checks `data` as a pack and adds it. When `replacing` is given (Check for update), that saved
   * pack is the one replaced; otherwise a loaded pack with the same id is. A replacement asks first.
   */
  const addPack = async (data: unknown, origin: PackOrigin, label: string, replacing?: StoredPack) => {
    const result = parseCareerPack(data)
    if (!result.ok) {
      setMessage({ kind: 'error', text: `${label}: ${result.reason}`, details: result.problems })
      return
    }
    let fingerprint: string
    try {
      fingerprint = await packFingerprint(data)
    } catch {
      setMessage({
        kind: 'error',
        text: `${label}: this page can't compute a pack fingerprint. Browsers allow it only on https:// pages and localhost.`,
        details: [],
      })
      return
    }
    const current = describePacks(storedRef.current).entries
    let target: PackEntry | undefined
    if (replacing) {
      target = current.find((e) => e.stored === replacing)
      if (!target) {
        setMessage({ kind: 'info', text: `${label}: the pack was removed while it was being checked.`, details: [] })
        return
      }
      const clash = current.find((e) => e.pack.id === result.pack.id && e !== target)
      if (clash) {
        setMessage({
          kind: 'error',
          text: `${label}: the pack now has the id "${result.pack.id}", which another loaded pack ("${clash.pack.name}") uses.`,
          details: [],
        })
        return
      }
    } else {
      target = current.find((e) => e.pack.id === result.pack.id)
    }
    if (target) {
      const question = replaceQuestion(
        target.pack.name,
        { id: target.pack.id, revision: target.pack.revision, fingerprint: target.stored.fingerprint },
        { id: result.pack.id, revision: result.pack.revision, fingerprint },
      )
      if (!window.confirm(question)) {
        setMessage({ kind: 'info', text: `Kept the loaded copy of "${target.pack.name}".`, details: [] })
        return
      }
    }
    const entry: StoredPack = { data, fingerprint, importedAt: new Date().toISOString(), origin }
    const old = target?.stored
    const next = old ? storedRef.current.map((s) => (s === old ? entry : s)) : [...storedRef.current, entry]
    const name = result.pack.name
    if (commit(next, unreadableRef.current) === 'failed') setUnsaved((u) => (u.includes(name) ? u : [...u, name]))
    const count = result.careers.length
    setMessage({
      kind: 'info',
      text: `Loaded "${name}" revision ${result.pack.revision}: ${count} career${count === 1 ? '' : 's'}.`,
      details: result.problems,
    })
  }

  const importFile = async (fileName: string, text: string) => {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      setMessage({ kind: 'error', text: `${fileName}: the file is not valid JSON.`, details: [] })
      return
    }
    await addPack(data, { kind: 'file', fileName }, fileName)
  }

  const importUrl = async (url: string) => {
    setBusy(true)
    try {
      const fetched = await fetchCareerPack(url)
      if (!fetched.ok) {
        setMessage({ kind: 'error', text: describeFetchError(url, fetched.error), details: [] })
        return
      }
      await addPack(fetched.data, { kind: 'url', url: url.trim() }, url)
    } finally {
      setBusy(false)
    }
  }

  const checkForUpdate = async (entry: PackEntry) => {
    if (entry.stored.origin.kind !== 'url') return
    const url = entry.stored.origin.url
    setBusy(true)
    try {
      const fetched = await fetchCareerPack(url)
      if (!fetched.ok) {
        setMessage({ kind: 'error', text: describeFetchError(url, fetched.error), details: [] })
        return
      }
      let fingerprint: string | undefined
      try {
        fingerprint = await packFingerprint(fetched.data)
      } catch {
        fingerprint = undefined
      }
      if (fingerprint === entry.stored.fingerprint) {
        setMessage({ kind: 'info', text: `"${entry.pack.name}" has not changed.`, details: [] })
        return
      }
      await addPack(fetched.data, entry.stored.origin, url, entry.stored)
    } finally {
      setBusy(false)
    }
  }

  const remove = (target: StoredPack, name: string) => {
    const result = commit(
      storedRef.current.filter((s) => s !== target),
      unreadableRef.current,
    )
    setUnsaved((u) => u.filter((n) => n !== name))
    if (result === 'failed') {
      setMessage({
        kind: 'error',
        text: `Removed "${name}" for this visit, but the change could not be saved, so it will come back after a reload.`,
        details: [],
      })
    } else {
      setMessage({ kind: 'info', text: `Removed "${name}".`, details: [] })
    }
  }

  const discardUnreadable = () => {
    const result = commit(storedRef.current, [])
    setMessage(
      result === 'failed'
        ? { kind: 'error', text: 'The unreadable saved data could not be deleted.', details: [] }
        : { kind: 'info', text: 'Deleted the unreadable saved data.', details: [] },
    )
  }

  return {
    entries: derived.entries,
    broken: derived.broken,
    careers: derived.combined.careers,
    duplicates: derived.combined.problems,
    unreadableCount: unreadable.length,
    storageAvailable: storage !== undefined,
    unsaved,
    message,
    busy,
    packsParam: derived.packsParam,
    importFile,
    importUrl,
    checkForUpdate,
    remove,
    discardUnreadable,
  }
}
