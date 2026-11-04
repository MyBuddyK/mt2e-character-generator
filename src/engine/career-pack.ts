import { z } from 'zod'
import { CareerSchema, parseCareer, type CareerDefinition } from './career-schema'
import { RulesSchema, type Rules } from './rules-schema'
import { parseSpecies, SpeciesSchema, type SpeciesDefinition } from './species'
import { combineById, compareCodeUnits } from './combine'
import { EducationSchema, parseEducation, type EducationDefinition } from './education-schema'

/**
 * Career packs: one JSON file that holds any number of careers, which a referee shares with their
 * players and each player imports into their own browser (see docs/features/career-import.md).
 */

/** The value every career pack has in its `format` field. */
export const PACK_FORMAT = 'mt2e-career-pack'

/**
 * The latest `formatVersion` this app reads. The app reads versions 1, 2 and 3; a pack with any other
 * version is rejected. Version 2 adds the optional `rules` object and `effects` on careers. Version 3
 * adds the optional `species` and `education` arrays.
 */
export const PACK_FORMAT_VERSION = 3

/** Every `formatVersion` this app reads: 1 up to PACK_FORMAT_VERSION. */
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = Array.from({ length: PACK_FORMAT_VERSION }, (_, i) => i + 1)

const nonEmpty = z.string().trim().min(1, 'must be a non-empty string')

/** The pack fields other than `careers`. Unknown keys are rejected by the schemas that use these. */
const packFields = {
  /** Optional link to a JSON Schema, for editors. The app ignores it. */
  $schema: z.string().optional(),
  format: z.literal(PACK_FORMAT),
  formatVersion: z.int().refine((v) => SUPPORTED_FORMAT_VERSIONS.includes(v), {
    message: `must be one of ${SUPPORTED_FORMAT_VERSIONS.join(', ')}`,
  }),
  id: nonEmpty,
  name: nonEmpty,
  /** A whole number the referee raises each time they edit the pack. */
  revision: z.int().min(0),
  source: nonEmpty,
  /** Values that apply to every career (version 2 only). See rules-schema.ts. */
  rules: RulesSchema.optional(),
}

/**
 * The full shape of a career pack, with every career checked by CareerSchema. Used to generate
 * the published JSON Schema. parseCareerPack does not use it directly, because it loads the valid
 * careers of a pack even when some careers fail.
 */
export const CareerPackSchema = z.strictObject({
  ...packFields,
  careers: z.array(CareerSchema).min(1, 'must have at least one career'),
  /** Species the pack defines (version 3 only). See species.ts. */
  species: z.array(SpeciesSchema).optional(),
  /** Pre-career education entries the pack defines (version 3 only). See education-schema.ts. */
  education: z.array(EducationSchema).optional(),
})

/** The pack fields with each career left unchecked, so careers can be checked one at a time. */
const PackEnvelopeSchema = z.strictObject({
  ...packFields,
  careers: z.array(z.unknown()).min(1, 'must have at least one career'),
  species: z.array(z.unknown()).optional(),
  education: z.array(z.unknown()).optional(),
})

/** The identifying fields of a pack that passed parseCareerPack. */
export interface PackInfo {
  id: string
  name: string
  revision: number
  source: string
}

/**
 * The result of parseCareerPack. On success: the pack's fields, the careers that passed, and one
 * message per skipped career problem. On failure: one line saying why the pack was rejected, and
 * the messages behind it.
 */
export type PackParseResult =
  | {
      ok: true
      pack: PackInfo
      careers: CareerDefinition[]
      rules: Rules | undefined
      species: SpeciesDefinition[]
      education: EducationDefinition[]
      problems: string[]
    }
  | { ok: false; reason: string; problems: string[] }

/** Returns true when `value` is a plain object (not null and not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns `items` joined for a message: "1", "1 and 2", "1, 2 and 3". */
function listText(items: readonly (string | number)[]): string {
  const text = items.map(String)
  const last = text.pop()
  if (last === undefined) return ''
  return text.length === 0 ? last : `${text.join(', ')} and ${last}`
}

/**
 * Returns " (<label>)" for use in messages, where the label is the career or species entry's `id` when that is a
 * string, otherwise its `name` when that is a string. Returns an empty string when neither is.
 */
function entryLabel(data: unknown): string {
  if (!isRecord(data)) return ''
  const id = data['id']
  const name = data['name']
  const label = typeof id === 'string' ? id : typeof name === 'string' ? name : undefined
  return label === undefined ? '' : ` (${label})`
}

/** Returns true when any event, mishap or rank in the raw careers has an `effects` key. */
function usesEffects(careers: unknown[]): boolean {
  const hasEffects = (list: unknown) => Array.isArray(list) && list.some((e) => isRecord(e) && 'effects' in e)
  return careers.some((c) => {
    if (!isRecord(c)) return false
    if (hasEffects(c['events']) || hasEffects(c['mishaps'])) return true
    const assignments = c['assignments']
    return Array.isArray(assignments) && assignments.some((a) => isRecord(a) && hasEffects(a['ranks']))
  })
}

/**
 * Checks parsed JSON as a career pack. It rejects the pack when it is not an object, when `format`
 * is not PACK_FORMAT, when `formatVersion` is not one of SUPPORTED_FORMAT_VERSIONS (with a message
 * naming them), when a version 1 pack uses `rules` or `effects` (with a message that it must say
 * version 2), when a version 1 or 2 pack lists `species` or `education` (with a message that it must say version 3),
 * when another pack field fails, or when no career passes. Otherwise it checks each career with
 * parseCareer and skips the ones that fail, and also skips a career whose id was used by an earlier
 * career in the same pack. Each skipped career adds messages of the form
 * "careers.<index> (<id>): <path>: <message>". Species are checked the same way with parseSpecies, and
 * each skipped species adds messages starting "species.<index> (<id>)"; education entries likewise, with
 * parseEducation and "education.<index> (<id>)". It does not throw for any input.
 */
export function parseCareerPack(data: unknown): PackParseResult {
  if (!isRecord(data)) {
    return { ok: false, reason: 'not a career pack: expected a JSON object', problems: [] }
  }
  if (data['format'] !== PACK_FORMAT) {
    return { ok: false, reason: `not a career pack: "format" must be "${PACK_FORMAT}"`, problems: [] }
  }
  const version = data['formatVersion']
  if (typeof version !== 'number' || !SUPPORTED_FORMAT_VERSIONS.includes(version)) {
    const got = typeof version === 'number' ? `format version ${version}` : 'no valid "formatVersion"'
    return {
      ok: false,
      reason: `this pack has ${got}; this app supports versions ${listText(SUPPORTED_FORMAT_VERSIONS)}`,
      problems: [],
    }
  }
  if (version === 1) {
    const rawCareers = data['careers']
    const features = [
      ...('rules' in data ? ['"rules"'] : []),
      ...(Array.isArray(rawCareers) && usesEffects(rawCareers) ? ['"effects"'] : []),
    ]
    if (features.length > 0) {
      return {
        ok: false,
        reason: `this pack uses ${features.join(' and ')}, so its "formatVersion" must be 2`,
        problems: [],
      }
    }
  }
  if (version < 3) {
    const features = ['species', 'education'].filter((k) => k in data).map((k) => `"${k}"`)
    if (features.length > 0) {
      return { ok: false, reason: `this pack uses ${features.join(' and ')}, so its "formatVersion" must be 3`, problems: [] }
    }
  }
  const envelope = PackEnvelopeSchema.safeParse(data)
  if (!envelope.success) {
    return {
      ok: false,
      reason: 'the pack fields are not valid',
      problems: envelope.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  const { careers: rawCareers, species: rawSpecies = [], education: rawEducation = [], id, name, revision, source, rules } = envelope.data
  const careers: CareerDefinition[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  rawCareers.forEach((raw, index) => {
    const prefix = `careers.${index}${entryLabel(raw)}`
    const result = parseCareer(raw)
    if (!result.ok) {
      problems.push(...result.errors.map((e) => `${prefix}: ${e}`))
      return
    }
    if (seen.has(result.career.id)) {
      problems.push(`${prefix}: id "${result.career.id}" is used by an earlier career in this pack`)
      return
    }
    seen.add(result.career.id)
    careers.push(result.career)
  })
  if (careers.length === 0) {
    return { ok: false, reason: 'no career in the pack is valid', problems }
  }
  const species: SpeciesDefinition[] = []
  const speciesIds = new Set<string>()
  rawSpecies.forEach((raw, index) => {
    const prefix = `species.${index}${entryLabel(raw)}`
    const result = parseSpecies(raw)
    if (!result.ok) {
      problems.push(...result.errors.map((e) => `${prefix}: ${e}`))
      return
    }
    if (speciesIds.has(result.species.id)) {
      problems.push(`${prefix}: id "${result.species.id}" is used by an earlier species in this pack`)
      return
    }
    speciesIds.add(result.species.id)
    species.push(result.species)
  })
  const education: EducationDefinition[] = []
  const educationIds = new Set<string>()
  rawEducation.forEach((raw, index) => {
    const prefix = `education.${index}${entryLabel(raw)}`
    const result = parseEducation(raw)
    if (!result.ok) {
      problems.push(...result.errors.map((e) => `${prefix}: ${e}`))
      return
    }
    if (educationIds.has(result.education.id)) {
      problems.push(`${prefix}: id "${result.education.id}" is used by an earlier education entry in this pack`)
      return
    }
    educationIds.add(result.education.id)
    education.push(result.education)
  })
  return { ok: true, pack: { id, name, revision, source }, careers, rules, species, education, problems }
}

/**
 * Returns `value` as JSON text with the keys of every object sorted, so two values with the same
 * content give the same text whatever order their keys were written in. Array order is kept.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!isRecord(v)) return v
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
  })
}

/**
 * Returns the pack fingerprint: the first 8 lowercase hex characters of the SHA-256 of
 * canonicalJson(data). Uses the Web Crypto API (`crypto.subtle`), which browsers provide only on
 * https pages and localhost.
 */
export async function packFingerprint(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A pack that passed parseCareerPack, as passed to combineCareers. */
export interface LoadedPack {
  id: string
  name: string
  careers: CareerDefinition[]
}

/** The result of combineCareers: the careers to list, and one message per duplicate id. */
export interface CombinedCareers {
  careers: CareerDefinition[]
  problems: string[]
}

/**
 * Returns the careers to offer. With no packs, that is `bundled`. With one or more packs, the
 * bundled careers are left out and the packs' careers are used instead, sorted by name and then id
 * using UTF-16 code unit order, so the order is the same in every locale. Packs are read in order of
 * their `id`, not the order they were imported, and a career whose id was already taken by an
 * earlier pack is left out and reported as "<pack name>: career id "<id>" is already used by
 * <other pack name>".
 */
export function combineCareers(bundled: CareerDefinition[], packs: LoadedPack[]): CombinedCareers {
  if (packs.length === 0) return { careers: bundled, problems: [] }
  const { items, problems } = combineById(
    packs.map((p) => ({ id: p.id, name: p.name, items: p.careers })),
    'career',
  )
  return { careers: items, problems }
}

/** One entry of the ?packs= link value: a pack id and the fingerprint it had. */
export interface PackRef {
  id: string
  fingerprint: string
}

/**
 * Returns the ?packs= value for `refs`: "id@fingerprint" entries sorted by id and joined with
 * commas, with each id URI-encoded. Returns an empty string for no refs.
 */
export function formatPackRefs(refs: PackRef[]): string {
  return [...refs]
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map((r) => `${encodeURIComponent(r.id)}@${r.fingerprint}`)
    .join(',')
}

/**
 * Parses a ?packs= value written by formatPackRefs. Entries without an "@", or with an empty id or
 * fingerprint, are dropped. The result is sorted by id.
 */
export function parsePackRefs(value: string): PackRef[] {
  const refs: PackRef[] = []
  for (const entry of value.split(',')) {
    const at = entry.lastIndexOf('@')
    if (at <= 0 || at === entry.length - 1) continue
    let id: string
    try {
      id = decodeURIComponent(entry.slice(0, at))
    } catch {
      continue
    }
    refs.push({ id, fingerprint: entry.slice(at + 1) })
  }
  return refs.sort((a, b) => compareCodeUnits(a.id, b.id))
}

/** The result of selectRules: the rules to use, the name of the pack they came from (undefined for the sample), and whether loaded packs disagree. */
export interface SelectedRules {
  rules: Rules
  packName: string | undefined
  differ: boolean
}

/**
 * Returns the rules to use: those of the pack whose `id` sorts first (in code unit order) among
 * `packs` that have `rules`, or `sample` when none has. `differ` is true when two of those packs'
 * rules are not the same (compared with canonicalJson).
 */
export function selectRules(packs: { id: string; name: string; rules: Rules | undefined }[], sample: Rules): SelectedRules {
  const withRules = packs
    .flatMap((p) => (p.rules ? [{ id: p.id, name: p.name, rules: p.rules }] : []))
    .sort((a, b) => compareCodeUnits(a.id, b.id))
  const first = withRules[0]
  if (!first) return { rules: sample, packName: undefined, differ: false }
  const text = canonicalJson(first.rules)
  return { rules: first.rules, packName: first.name, differ: withRules.some((p) => canonicalJson(p.rules) !== text) }
}

/** One loaded pack's education entries, as passed to combineEducation. */
export interface PackEducation {
  id: string
  name: string
  education: EducationDefinition[]
}

/**
 * Returns the education entries to offer, with one message per duplicate id. With no packs that is
 * `bundled`; with one or more packs the bundled entries are left out and the packs' entries are merged by
 * id, read in order of pack id and sorted by name, as combineCareers does for careers.
 */
export function combineEducation(bundled: EducationDefinition[], packs: PackEducation[]): { education: EducationDefinition[]; problems: string[] } {
  if (packs.length === 0) return { education: bundled, problems: [] }
  const { items, problems } = combineById(
    packs.map((p) => ({ id: p.id, name: p.name, items: p.education })),
    'education',
  )
  return { education: items, problems }
}
