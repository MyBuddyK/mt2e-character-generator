import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  combineCareers,
  formatPackRefs,
  packFingerprint,
  parseCareerPack,
  parsePackRefs,
  type LoadedPack,
} from './career-pack'
import { careerPackJsonSchema } from './pack-json-schema'
import type { CareerDefinition } from './career-schema'
import { readStoredPacks, STORAGE_KEY, writeStoredPacks, type StoredPack } from '../storage/career-packs'
import { describeFetchError, fetchCareerPack, type FetchFn } from '../storage/fetch-pack'
import { replaceQuestion } from '../use-career-packs'
import validPack from '../../e2e/fixtures/valid-pack.json'
import partlyInvalidPack from '../../e2e/fixtures/partly-invalid-pack.json'
import laterVersionPack from '../../e2e/fixtures/later-version-pack.json'

/** Returns a deep copy of the valid test pack, for tests that change one field at a time. */
function pack(): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(validPack)
  return copy
}

/** Returns the careers of the valid test pack after parseCareerPack, or throws if it does not pass. */
function validCareers(): CareerDefinition[] {
  const result = parseCareerPack(validPack)
  if (!result.ok) throw new Error(result.reason)
  return result.careers
}

/** Returns a copy of `career` with a new id and name. */
function renamed(career: CareerDefinition, id: string, name: string): CareerDefinition {
  return { ...career, id, name }
}

/** An in-memory Storage. When `failWrites` is true, setItem throws a QuotaExceededError DOMException. */
class MemoryStorage implements Storage {
  readonly items = new Map<string, string>()
  failWrites = false
  get length(): number {
    return this.items.size
  }
  clear(): void {
    this.items.clear()
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError')
    this.items.set(key, value)
  }
}

/** Returns a StoredPack holding the valid test pack, imported from a file with `fingerprint`. */
function storedPack(fingerprint: string): StoredPack {
  return {
    data: validPack,
    fingerprint,
    importedAt: '2026-11-03T00:00:00.000Z',
    origin: { kind: 'file', fileName: 'valid-pack.json' },
  }
}

// Tests for parseCareerPack in career-pack.ts.
describe('parseCareerPack', () => {
  // Parses e2e/fixtures/valid-pack.json and expects its fields, both careers and no problems.
  it('loads a valid pack with all of its careers', () => {
    const result = parseCareerPack(validPack)
    expect(result).toMatchObject({
      ok: true,
      pack: { id: 'test-core', name: 'Test core pack', revision: 1 },
      problems: [],
    })
    expect(result.ok && result.careers.map((c) => c.id)).toEqual(['test-courier', 'test-surveyor'])
  })

  // Parses the partly invalid fixture and expects the valid career to load and the other to be
  // reported by index, id and field.
  // Criteria: PK-8.
  it('skips an invalid career and reports it by index and field', () => {
    const result = parseCareerPack(partlyInvalidPack)
    expect(result.ok && result.careers.map((c) => c.id)).toEqual(['test-courier'])
    expect(result.problems).toEqual([expect.stringMatching(/^careers\.1 \(test-surveyor\): qualification\.target: /)])
  })

  // Parses a string, an array and null, and expects each to be rejected as not a JSON object.
  it('rejects a value that is not an object', () => {
    for (const value of ['pack', [], null]) {
      expect(parseCareerPack(value)).toMatchObject({ ok: false, reason: 'not a career pack: expected a JSON object' })
    }
  })

  // Sets format to another value and expects a message naming the expected format.
  it('rejects a pack with the wrong format', () => {
    const data = pack()
    data['format'] = 'something-else'
    expect(parseCareerPack(data)).toMatchObject({ ok: false, reason: 'not a career pack: "format" must be "mt2e-career-pack"' })
  })

  // Parses the later-version fixture (formatVersion 3) and expects a message naming versions 1 and 2.
  // Criteria: PK-7.
  it('rejects a later format version and names the supported version', () => {
    expect(parseCareerPack(laterVersionPack)).toMatchObject({
      ok: false,
      reason: 'this pack has format version 3; this app supports versions 1 and 2',
    })
  })

  // Removes formatVersion and expects a message saying it is missing.
  it('rejects a pack without a format version', () => {
    const data = pack()
    delete data['formatVersion']
    expect(parseCareerPack(data)).toMatchObject({ ok: false, reason: expect.stringContaining('no valid "formatVersion"') })
  })

  // Adds a "$schema" field, as an editor would, and expects the pack to load.
  it('accepts a $schema field', () => {
    const data = pack()
    data['$schema'] = './career-pack.schema.json'
    expect(parseCareerPack(data).ok).toBe(true)
  })

  // Sets revision to 1.5 and adds an unknown key, and expects both to be listed as pack field problems.
  it('rejects invalid pack fields and lists them', () => {
    const data = pack()
    data['revision'] = 1.5
    data['extra'] = true
    const result = parseCareerPack(data)
    expect(result).toMatchObject({ ok: false, reason: 'the pack fields are not valid' })
    expect(result.problems).toContainEqual(expect.stringMatching(/^revision: /))
    expect(result.problems).toContainEqual(expect.stringMatching(/^\(root\): .*extra/))
  })

  // Replaces every career with an empty object and expects the pack to be rejected with each problem listed.
  it('rejects a pack with no valid career', () => {
    const data = pack()
    data['careers'] = [{}, {}]
    const result = parseCareerPack(data)
    expect(result).toMatchObject({ ok: false, reason: 'no career in the pack is valid' })
    expect(result.problems).toContainEqual(expect.stringMatching(/^careers\.0: id: /))
    expect(result.problems).toContainEqual(expect.stringMatching(/^careers\.1: id: /))
  })

  // Gives the second career a numeric id and expects its problems labelled with its name instead.
  it('labels a skipped career by name when its id is not a string', () => {
    const data = pack()
    const [first, second] = validPack.careers
    data['careers'] = [first, { ...second, id: 5 }]
    expect(parseCareerPack(data).problems).toContainEqual(expect.stringMatching(/^careers\.1 \(Test Surveyor\): id: /))
  })

  // Lists the first career twice and expects the second copy to be skipped and reported.
  it('skips a career whose id is used earlier in the same pack', () => {
    const data = pack()
    const [first] = validPack.careers
    data['careers'] = [first, first]
    const result = parseCareerPack(data)
    expect(result.ok && result.careers).toHaveLength(1)
    expect(result.problems).toEqual(['careers.1 (test-courier): id "test-courier" is used by an earlier career in this pack'])
  })
})

// Tests for canonicalJson and packFingerprint in career-pack.ts.
describe('pack fingerprint', () => {
  // Writes the same nested object with its keys in two orders and expects identical text.
  it('canonicalJson sorts object keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: 0 } })).toBe('{"a":{"c":0,"d":[2,1]},"b":1}')
    expect(canonicalJson({ a: { c: 0, d: [2, 1] }, b: 1 })).toBe('{"a":{"c":0,"d":[2,1]},"b":1}')
  })

  // Fingerprints the valid pack and a copy with its top-level keys reversed, and expects the same
  // 8 hex characters for both.
  it('gives 8 hex characters that do not depend on key order', async () => {
    const reversed = Object.fromEntries(Object.entries(pack()).reverse())
    const a = await packFingerprint(validPack)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(await packFingerprint(reversed)).toBe(a)
  })

  // Pins the fingerprint of {"a":1}: the first 8 hex characters of SHA-256 of the text {"a":1}.
  it('is the start of the SHA-256 of the canonical JSON', async () => {
    expect(await packFingerprint({ a: 1 })).toBe('015abd7f')
  })

  // Changes one career summary without changing the revision, and expects a different fingerprint.
  it('changes when content changes, even with the same revision', async () => {
    const data = structuredClone(validPack)
    const [first] = data.careers
    if (first) first.summary = 'Changed summary'
    expect(await packFingerprint(data)).not.toBe(await packFingerprint(validPack))
  })
})

// Tests for combineCareers in career-pack.ts.
describe('combineCareers', () => {
  const bundled = [renamed(validCareers()[0] ?? fail(), 'sample-sanitation', 'Sample')]

  // Passes no packs and expects the bundled careers back with no problems.
  // Criteria: PK-1.
  it('returns the bundled careers when no pack is loaded', () => {
    expect(combineCareers(bundled, [])).toEqual({ careers: bundled, problems: [] })
  })

  // Passes one pack whose career reuses the bundled sample's id, and expects only the pack's career,
  // with no duplicate reported.
  it('leaves out the bundled careers once a pack is loaded, so a pack may reuse their ids', () => {
    const career = renamed(validCareers()[0] ?? fail(), 'sample-sanitation', 'Pack version')
    const result = combineCareers(bundled, [{ id: 'p', name: 'P', careers: [career] }])
    expect(result).toEqual({ careers: [career], problems: [] })
  })

  // Builds packs "a-pack" and "b-pack" that share a career id, passes them in both orders, and expects
  // the career from "a-pack" each time, with the duplicate reported.
  // Criteria: PK-17.
  it('keeps the career from the pack whose id sorts first, whatever the import order', () => {
    const [career] = validCareers()
    if (!career) fail()
    const a: LoadedPack = { id: 'a-pack', name: 'A', careers: [renamed(career, 'scout', 'Scout from A')] }
    const b: LoadedPack = { id: 'b-pack', name: 'B', careers: [renamed(career, 'scout', 'Scout from B')] }
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const result = combineCareers(bundled, order)
      expect(result.careers.map((c) => c.name)).toEqual(['Scout from A'])
      expect(result.problems).toEqual(['B: career id "scout" is already used by A'])
    }
  })

  // Passes careers named Zeta, alpha, Alpha and Ångström and expects UTF-16 code unit order
  // (capitals before lower case, Å after z), which does not depend on the locale.
  it('sorts the combined careers by name in code unit order', () => {
    const [career] = validCareers()
    if (!career) fail()
    const careers = [
      renamed(career, 'z', 'Zeta'),
      renamed(career, 'a2', 'alpha'),
      renamed(career, 'a1', 'Alpha'),
      renamed(career, 'o', 'Ångström'),
    ]
    expect(combineCareers([], [{ id: 'p', name: 'P', careers }]).careers.map((c) => c.name)).toEqual([
      'Alpha',
      'Zeta',
      'alpha',
      'Ångström',
    ])
  })
})

// Tests for formatPackRefs and parsePackRefs in career-pack.ts.
describe('pack refs in links', () => {
  // Formats two refs given out of order and expects them sorted by id and joined with commas.
  it('formats refs sorted by id', () => {
    expect(
      formatPackRefs([
        { id: 'b', fingerprint: '22222222' },
        { id: 'a', fingerprint: '11111111' },
      ]),
    ).toBe('a@11111111,b@22222222')
  })

  // Formats a ref whose id has a comma and an @, parses the text back, and expects the same ref.
  it('round-trips ids that contain commas or @', () => {
    const refs = [{ id: 'my,pack@1', fingerprint: 'abcdef12' }]
    expect(parsePackRefs(formatPackRefs(refs))).toEqual(refs)
  })

  // Parses entries with no @, an empty id or an empty fingerprint, and expects them dropped.
  it('drops malformed entries', () => {
    expect(parsePackRefs('nope,@abc,id@,good@12345678')).toEqual([{ id: 'good', fingerprint: '12345678' }])
  })
})

// Tests for readStoredPacks and writeStoredPacks in storage/career-packs.ts, using an in-memory Storage.
describe('pack storage', () => {
  // Writes one pack, reads it back, and expects the same pack under STORAGE_KEY.
  it('saves and reads back packs', () => {
    const storage = new MemoryStorage()
    expect(writeStoredPacks(storage, [storedPack('11111111')])).toBe('saved')
    expect(storage.items.has(STORAGE_KEY)).toBe(true)
    expect(readStoredPacks(storage)).toEqual({ packs: [storedPack('11111111')], unreadable: [] })
  })

  // Saves one pack, makes writes throw QuotaExceededError, tries to save two, and expects "failed"
  // with the first save still readable.
  it('keeps the earlier saved value when a write fails', () => {
    const storage = new MemoryStorage()
    writeStoredPacks(storage, [storedPack('11111111')])
    storage.failWrites = true
    expect(writeStoredPacks(storage, [storedPack('11111111'), storedPack('22222222')])).toBe('failed')
    expect(readStoredPacks(storage).packs).toEqual([storedPack('11111111')])
  })

  // Saves one pack, then saves an empty list, and expects the key to be removed.
  it('removes the key when no packs are left', () => {
    const storage = new MemoryStorage()
    writeStoredPacks(storage, [storedPack('11111111')])
    writeStoredPacks(storage, [])
    expect(storage.items.has(STORAGE_KEY)).toBe(false)
  })

  // Passes undefined storage and expects no packs on read and "unavailable" on write.
  it('reports unavailable storage', () => {
    expect(readStoredPacks(undefined)).toEqual({ packs: [], unreadable: [] })
    expect(writeStoredPacks(undefined, [storedPack('11111111')])).toBe('unavailable')
  })

  // Stores text that is not JSON, then a JSON object, then an array with one valid and one invalid
  // entry, and expects the parts it can't read returned as unreadable values.
  it('returns the saved values it cannot read', () => {
    const storage = new MemoryStorage()
    storage.items.set(STORAGE_KEY, 'not json')
    expect(readStoredPacks(storage)).toEqual({ packs: [], unreadable: ['not json'] })
    storage.items.set(STORAGE_KEY, '{"a":1}')
    expect(readStoredPacks(storage)).toEqual({ packs: [], unreadable: [{ a: 1 }] })
    storage.items.set(STORAGE_KEY, JSON.stringify([storedPack('11111111'), { data: 1 }]))
    expect(readStoredPacks(storage)).toEqual({ packs: [storedPack('11111111')], unreadable: [{ data: 1 }] })
  })

  // Saves one pack with one unreadable value, reads back, and expects the unreadable value kept.
  it('writes unreadable values back so a save does not delete them', () => {
    const storage = new MemoryStorage()
    writeStoredPacks(storage, [storedPack('11111111')], [{ data: 1 }])
    expect(readStoredPacks(storage)).toEqual({ packs: [storedPack('11111111')], unreadable: [{ data: 1 }] })
  })
})

// Tests for fetchCareerPack and describeFetchError in storage/fetch-pack.ts, with a stub fetch.
describe('fetchCareerPack', () => {
  /** Returns a stub fetch that records each URL it is called with and answers with `respond()`. */
  function stub(respond: () => Promise<Response>): { fetchFn: FetchFn; calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      fetchFn: (url) => {
        calls.push(url)
        return respond()
      },
    }
  }

  // Passes http, ftp and non-URL text, and expects "not-https" with no request made.
  // Criteria: PK-14.
  it('refuses links that are not https without making a request', async () => {
    const { fetchFn, calls } = stub(() => Promise.resolve(new Response('{}')))
    for (const url of ['http://packs.test/a.json', 'ftp://packs.test/a.json', 'packs.test/a.json']) {
      expect(await fetchCareerPack(url, fetchFn)).toEqual({ ok: false, error: { kind: 'not-https' } })
    }
    expect(calls).toEqual([])
  })

  // Answers with a JSON body and expects the parsed value.
  it('returns the parsed JSON body', async () => {
    const { fetchFn } = stub(() => Promise.resolve(new Response('{"a":1}')))
    expect(await fetchCareerPack('https://packs.test/a.json', fetchFn)).toEqual({ ok: true, data: { a: 1 } })
  })

  // Answers with status 404 and expects an "http-status" error with 404.
  it('reports an HTTP error status', async () => {
    const { fetchFn } = stub(() => Promise.resolve(new Response('missing', { status: 404 })))
    expect(await fetchCareerPack('https://packs.test/a.json', fetchFn)).toEqual({
      ok: false,
      error: { kind: 'http-status', status: 404 },
    })
  })

  // Makes the request reject with a TypeError, as a browser does for CORS or network failures, and
  // expects "blocked-or-offline".
  it('reports a request that failed', async () => {
    const { fetchFn } = stub(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await fetchCareerPack('https://packs.test/a.json', fetchFn)).toEqual({
      ok: false,
      error: { kind: 'blocked-or-offline' },
    })
  })

  // Answers with a body that is not JSON and expects "not-json".
  it('reports a body that is not JSON', async () => {
    const { fetchFn } = stub(() => Promise.resolve(new Response('<html>')))
    expect(await fetchCareerPack('https://packs.test/a.json', fetchFn)).toEqual({
      ok: false,
      error: { kind: 'not-json' },
    })
  })

  // Describes each error kind and expects each message to name the URL, and the status message to include 404.
  it('describes each error with the URL', () => {
    const url = 'https://packs.test/a.json'
    expect(describeFetchError(url, { kind: 'not-https' })).toBe(`${url}: only https:// links are accepted.`)
    expect(describeFetchError(url, { kind: 'http-status', status: 404 })).toContain('HTTP status 404')
    expect(describeFetchError(url, { kind: 'blocked-or-offline' })).toContain('Import from file')
    expect(describeFetchError(url, { kind: 'not-json' })).toContain('not valid JSON')
  })
})

// Tests for replaceQuestion in use-career-packs.ts.
describe('replaceQuestion', () => {
  // Builds the question for revision 1 to 2 and expects both revisions and fingerprints with no warning.
  it('names both revisions and fingerprints', () => {
    const text = replaceQuestion('Core', { id: 'core', revision: 1, fingerprint: 'aaaaaaaa' }, { id: 'core', revision: 2, fingerprint: 'bbbbbbbb' })
    expect(text).toContain('Loaded: revision 1 (fingerprint aaaaaaaa)')
    expect(text).toContain('New: revision 2 (fingerprint bbbbbbbb)')
    expect(text).not.toContain('was not raised')
    expect(text).not.toContain('pack id changes')
  })

  // Builds the question for a pack whose id changes from core to core-2 and expects a line naming both ids.
  it('names both ids when the pack id changes', () => {
    const text = replaceQuestion('Core', { id: 'core', revision: 1, fingerprint: 'aaaaaaaa' }, { id: 'core-2', revision: 2, fingerprint: 'bbbbbbbb' })
    expect(text).toContain('The pack id changes from "core" to "core-2".')
  })

  // Builds the question for changed content at the same revision and expects the warning line.
  it('warns when the content changed but the revision was not raised', () => {
    const text = replaceQuestion('Core', { id: 'core', revision: 3, fingerprint: 'aaaaaaaa' }, { id: 'core', revision: 3, fingerprint: 'bbbbbbbb' })
    expect(text).toContain('the revision was not raised')
  })
})

// Tests for careerPackJsonSchema in pack-json-schema.ts.
describe('career pack JSON Schema', () => {
  // Generates the schema and expects the pack fields to be required and the format to be fixed.
  it('requires the pack fields and fixes the format value', () => {
    const schema = careerPackJsonSchema()
    expect(schema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['format', 'formatVersion', 'id', 'name', 'revision', 'source', 'careers']),
      properties: { format: { const: 'mt2e-career-pack' } },
    })
  })
})

/** Throws, for tests whose fixture is missing an expected value. Never returns. */
function fail(): never {
  throw new Error('test fixture is missing an expected value')
}
