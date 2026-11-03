import { useState } from 'react'
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
  /** The careers to list: the bundled careers when no pack is loaded, otherwise the packs' careers. */
  careers: CareerDefinition[]
  /** Duplicate career id messages from combineCareers. */
  duplicates: string[]
  /** Messages about saved data that could not be read back, for example after a schema change. */
  unreadable: string[]
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
  /** Removes a pack and saves the remaining ones. */
  remove: (entry: PackEntry) => void
}

/** Returns "revision N (fingerprint)" for use in confirmation messages. */
function revisionText(revision: number, fingerprint: string): string {
  return `revision ${revision} (fingerprint ${fingerprint})`
}

/**
 * Returns the text of the confirmation shown before a pack replaces a loaded pack with the same id.
 * It names both revisions and fingerprints, and adds a line when the content changed but the new
 * revision is not higher than the loaded one.
 */
export function replaceQuestion(
  name: string,
  loaded: { revision: number; fingerprint: string },
  incoming: { revision: number; fingerprint: string },
): string {
  const lines = [
    `Replace the career pack "${name}"?`,
    `Loaded: ${revisionText(loaded.revision, loaded.fingerprint)}`,
    `New: ${revisionText(incoming.revision, incoming.fingerprint)}`,
  ]
  if (incoming.fingerprint !== loaded.fingerprint && incoming.revision <= loaded.revision) {
    lines.push('The content changed but the revision was not raised. The referee may have forgotten to raise it.')
  }
  return lines.join('\n')
}

/**
 * React hook that holds the imported career packs. It reads the saved packs from localStorage once
 * on first render, and after each import, replacement or removal it writes them back with
 * writeStoredPacks. Replacing a loaded pack asks for confirmation with window.confirm. `bundled` is
 * the list of careers built into the app; it is shown only while no pack is loaded.
 */
export function useCareerPacks(bundled: CareerDefinition[]): CareerPacks {
  const [storage] = useState(() => browserStorage())
  const [initial] = useState(() => readStoredPacks(storage))
  const [stored, setStored] = useState<StoredPack[]>(initial.packs)
  const [unsaved, setUnsaved] = useState<string[]>([])
  const [message, setMessage] = useState<PackMessage | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const entries: PackEntry[] = []
  const unreadable: string[] = []
  if (initial.unreadable > 0) {
    unreadable.push(`${initial.unreadable} saved entr${initial.unreadable === 1 ? 'y' : 'ies'} could not be read.`)
  }
  for (const s of stored) {
    const result = parseCareerPack(s.data)
    if (result.ok) entries.push({ stored: s, pack: result.pack, careers: result.careers, problems: result.problems })
    else unreadable.push(`A saved pack could not be loaded: ${result.reason}`)
  }
  const combined = combineCareers(
    bundled,
    entries.map((e) => ({ id: e.pack.id, name: e.pack.name, careers: e.careers })),
  )
  const packsParam = formatPackRefs(entries.map((e) => ({ id: e.pack.id, fingerprint: e.stored.fingerprint })))

  /** Sets the saved packs to `next`, writes them, and records `name` as unsaved when the write fails. */
  const save = (next: StoredPack[], name: string | undefined) => {
    setStored(next)
    const result = writeStoredPacks(storage, next)
    if (result === 'saved') setUnsaved([])
    else if (result === 'failed' && name !== undefined) setUnsaved((u) => (u.includes(name) ? u : [...u, name]))
  }

  /** Checks `data` as a pack and adds it, or replaces the loaded pack with the same id after confirmation. */
  const addPack = async (data: unknown, origin: PackOrigin, label: string) => {
    const result = parseCareerPack(data)
    if (!result.ok) {
      setMessage({ kind: 'error', text: `${label}: ${result.reason}`, details: result.problems })
      return
    }
    const fingerprint = await packFingerprint(data)
    const existing = entries.find((e) => e.pack.id === result.pack.id)
    if (existing) {
      const question = replaceQuestion(
        existing.pack.name,
        { revision: existing.pack.revision, fingerprint: existing.stored.fingerprint },
        { revision: result.pack.revision, fingerprint },
      )
      if (!window.confirm(question)) {
        setMessage({ kind: 'info', text: `Kept the loaded copy of "${existing.pack.name}".`, details: [] })
        return
      }
    }
    const entry: StoredPack = { data, fingerprint, importedAt: new Date().toISOString(), origin }
    const next = existing ? stored.map((s) => (s === existing.stored ? entry : s)) : [...stored, entry]
    save(next, result.pack.name)
    const count = result.careers.length
    setMessage({
      kind: 'info',
      text: `Loaded "${result.pack.name}" revision ${result.pack.revision}: ${count} career${count === 1 ? '' : 's'}.`,
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
      if ((await packFingerprint(fetched.data)) === entry.stored.fingerprint) {
        setMessage({ kind: 'info', text: `"${entry.pack.name}" has not changed.`, details: [] })
        return
      }
      await addPack(fetched.data, entry.stored.origin, url)
    } finally {
      setBusy(false)
    }
  }

  const remove = (entry: PackEntry) => {
    save(
      stored.filter((s) => s !== entry.stored),
      undefined,
    )
    setUnsaved((u) => u.filter((n) => n !== entry.pack.name))
    setMessage({ kind: 'info', text: `Removed "${entry.pack.name}".`, details: [] })
  }

  return {
    entries,
    careers: combined.careers,
    duplicates: combined.problems,
    unreadable,
    storageAvailable: storage !== undefined,
    unsaved,
    message,
    busy,
    packsParam,
    importFile,
    importUrl,
    checkForUpdate,
    remove,
  }
}
