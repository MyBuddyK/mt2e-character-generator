import { z } from 'zod'
import { CHARACTERISTICS } from './characteristics'
import { EffectsSchema } from './effects'

/**
 * Schema and types for the career data files in src/data/careers. Adding a career means adding a
 * JSON file that passes CareerSchema; no code changes are needed.
 *
 * Descriptions hold short summaries, not rulebook text (see the rules in CLAUDE.md).
 */

const nonEmpty = z.string().trim().min(1, 'must be a non-empty string')

/**
 * A characteristic check that succeeds on 2D + DM >= target, e.g. END 7+. Targets are integers from 0
 * to 20. `characteristic` is one characteristic, or a list of them, in which case the check uses the
 * highest DM among them (for example "DEX or INT 5+").
 */
export const CheckSchema = z.object({
  characteristic: z.union([z.enum(CHARACTERISTICS), z.array(z.enum(CHARACTERISTICS)).min(1, 'must list at least one characteristic')]),
  target: z.int().min(0).max(20),
})
/** A characteristic check, as described by CheckSchema. */
export type Check = z.infer<typeof CheckSchema>

/**
 * A career's qualification check: a CheckSchema check, plus optional rules.
 * - `automatic`: true skips the roll and always qualifies.
 * - `automaticAt`: qualifies without a roll when the checked characteristic is at least this value.
 * - `ageDM`: a DM on the roll when the character is at least `fromAge` years old at the start of the term.
 */
export const QualificationSchema = CheckSchema.extend({
  automatic: z.boolean().optional(),
  automaticAt: z.int().min(0).optional(),
  ageDM: z.strictObject({ fromAge: z.int().min(0), dm: z.int() }).optional(),
})
/** A qualification check, as described by QualificationSchema. */
export type Qualification = z.infer<typeof QualificationSchema>

/**
 * One entry in a D6 skill table: a skill name, optionally with a level or speciality, or a characteristic
 * change such as "DEX" or "DEX +1" (read by asCharacteristic in terms.ts).
 */
export const SkillTableEntrySchema = nonEmpty
/** One skill table entry, as described by SkillTableEntrySchema. */
export type SkillTableEntry = z.infer<typeof SkillTableEntrySchema>

/** A D6 skill table: exactly six entries, indexed by the D6 roll minus one. */
export const SkillTableSchema = z.array(SkillTableEntrySchema).length(6, 'must have exactly 6 entries')

/**
 * An event or mishap table entry: the roll it answers to, a short summary, an optional
 * `connection` flag that marks the entry as a possible link between two characters, and optional
 * structured `effects` that the career engine applies (see effects.ts).
 */
export const EventEntrySchema = z.object({
  roll: z.int(),
  summary: nonEmpty,
  connection: z.boolean().optional(),
  effects: EffectsSchema,
})
/** One event or mishap entry, as described by EventEntrySchema. */
export type EventEntry = z.infer<typeof EventEntrySchema>

/**
 * A rank within an assignment: its number (0 to 6), optional title, optional free-text bonus gained
 * on reaching it, and optional `effects` that the career engine applies for that bonus.
 */
export const RankSchema = z.object({
  rank: z.int().min(0).max(6),
  title: nonEmpty.optional(),
  bonus: nonEmpty.optional(),
  effects: EffectsSchema,
})
/** One rank, as described by RankSchema. */
export type Rank = z.infer<typeof RankSchema>

/**
 * Returns a zod check that adds an issue when the `roll` values in an array are not exactly the
 * integers from `min` to `max`, each appearing once.
 */
function coversRolls(min: number, max: number) {
  return (entries: { roll: number }[], ctx: z.RefinementCtx) => {
    const rolls = entries.map((e) => e.roll).sort((a, b) => a - b)
    const expected = Array.from({ length: max - min + 1 }, (_, i) => min + i)
    if (rolls.length !== expected.length || rolls.some((r, i) => r !== expected[i])) {
      ctx.addIssue({
        code: 'custom',
        message: `roll values must be ${min} to ${max}, each once; got [${rolls.join(', ')}]`,
      })
    }
  }
}

/** Returns a zod check that adds an issue for each value of `key` that appears more than once in an array. */
function uniqueBy<K extends string>(key: K) {
  return (entries: Record<K, string | number>[], ctx: z.RefinementCtx) => {
    const seen = new Set<string | number>()
    for (const entry of entries) {
      const value = entry[key]
      if (seen.has(value)) ctx.addIssue({ code: 'custom', message: `duplicate ${key} "${value}"` })
      seen.add(value)
    }
  }
}

/** One assignment within a career, with its own survival and advancement checks, skill table and ranks. */
export const AssignmentSchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  survival: CheckSchema,
  advancement: CheckSchema,
  skills: SkillTableSchema,
  ranks: z.array(RankSchema).min(1, 'must have at least one rank').superRefine(uniqueBy('rank')),
})
/** One assignment, as described by AssignmentSchema. */
export type Assignment = z.infer<typeof AssignmentSchema>

/** One mustering-out row: the 1D roll (1 to 7), a non-negative whole cash amount, the benefit and optional `shipShares`. */
export const MusterOutEntrySchema = z.object({
  roll: z.int(),
  cash: z.int().min(0),
  benefit: nonEmpty,
  /** Optional. The ship shares this benefit gives, added to the character's ship shares when it is rolled. */
  shipShares: z.int().min(1).optional(),
})
/** One mustering-out row, as described by MusterOutEntrySchema. */
export type MusterOutEntry = z.infer<typeof MusterOutEntrySchema>

/** The full contents of one career data file. Unknown keys are rejected. */
export const CareerSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  /** Where the full rules for this career live, e.g. "Core Rulebook p.XX". */
  source: nonEmpty,
  summary: nonEmpty,
  qualification: QualificationSchema,
  /**
   * Optional. "assignment" makes basic training use the assignment's skill table instead of the table
   * named in the rules (the book does this for some careers).
   */
  basicTraining: z.literal('assignment').optional(),
  skillTables: z.strictObject({
    personalDevelopment: SkillTableSchema,
    serviceSkills: SkillTableSchema,
    advancedEducation: SkillTableSchema.optional(),
    /** Optional. Offered only to officers (characters who passed the commission check). */
    officer: SkillTableSchema.optional(),
  }),
  assignments: z.array(AssignmentSchema).min(1, 'must have at least one assignment').superRefine(uniqueBy('id')),
  /** Optional. The commission check. A career without it offers no commission. */
  commission: CheckSchema.optional(),
  /** Optional. Officer ranks 1 to 6, used once the character is commissioned. */
  officerRanks: z.array(RankSchema).min(1, 'must have at least one rank').superRefine(uniqueBy('rank')).optional(),
  /** 2D events: one entry for each roll from 2 to 12. */
  events: z.array(EventEntrySchema).superRefine(coversRolls(2, 12)),
  /** D6 mishaps: one entry for each roll from 1 to 6. */
  mishaps: z.array(EventEntrySchema).superRefine(coversRolls(1, 6)),
  /** Mustering-out table: one entry for each roll from 1 to 7. */
  musteringOut: z.array(MusterOutEntrySchema).superRefine(coversRolls(1, 7)),
})
/** A validated career, as described by CareerSchema. */
export type CareerDefinition = z.infer<typeof CareerSchema>

/** The result of parseCareer: the typed career, or the list of problems found. */
export type ParseResult = { ok: true; career: CareerDefinition } | { ok: false; errors: string[] }

/**
 * Checks parsed JSON against CareerSchema. Returns the typed career when it passes, otherwise one
 * message per problem in the form "path: message". It does not throw for any input.
 */
export function parseCareer(data: unknown): ParseResult {
  const result = CareerSchema.safeParse(data)
  if (result.success) return { ok: true, career: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  }
}

/** The result of loadCareers: every career that passed, and one message per problem, prefixed with the file name. */
export interface LoadResult {
  careers: CareerDefinition[]
  errors: string[]
}

/**
 * Parses every file in `files` (file name → parsed JSON) with parseCareer. Files that fail are left
 * out of `careers`, and their problems are added to `errors`. A career whose id was already used by
 * an earlier file (in file-name order) is also left out and reported. Careers are sorted by name.
 */
export function loadCareers(files: Record<string, unknown>): LoadResult {
  const careers: CareerDefinition[] = []
  const errors: string[] = []
  const idOwners = new Map<string, string>()
  for (const [file, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const result = parseCareer(data)
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `${file}: ${e}`))
      continue
    }
    const owner = idOwners.get(result.career.id)
    if (owner) {
      errors.push(`${file}: id "${result.career.id}" is already used by ${owner}`)
      continue
    }
    idOwners.set(result.career.id, file)
    careers.push(result.career)
  }
  careers.sort((a, b) => a.name.localeCompare(b.name))
  return { careers, errors }
}
