import { z } from 'zod'
import { CHARACTERISTICS } from './characteristics'
import { CheckSchema, coversRolls, EventEntrySchema } from './career-schema'
import { EffectsSchema } from './effects'
import { compareCodeUnits } from './combine'

/**
 * Pre-career education entries (docs/features/education.md): a university or an academy, taken as a term in
 * place of a career term. Every value comes from the pack; the repo's sample school is invented.
 */

const nonEmpty = z.string().trim().min(1, 'must be a non-empty string')

/** A DM of `dm` on a roll when `characteristic` is at least `atLeast`. */
export const CharacteristicDMSchema = z.strictObject({
  characteristic: z.enum(CHARACTERISTICS),
  atLeast: z.int().min(0),
  dm: z.int(),
})
/** One characteristic DM, as described by CharacteristicDMSchema. */
export type CharacteristicDM = z.infer<typeof CharacteristicDMSchema>

/**
 * The entry check: a characteristic check, plus optional `termDMs` (a DM when the attempt is made in that
 * term number, such as a penalty in terms 2 and 3) and `dms` (characteristic DMs).
 */
export const EducationEntrySchema = z.strictObject({
  ...CheckSchema.shape,
  termDMs: z.array(z.strictObject({ term: z.int().min(1), dm: z.int() })).optional(),
  dms: z.array(CharacteristicDMSchema).optional(),
})

/**
 * The skills on entry:
 * - `pick`: the player picks one skill from `list` for each value in `levels`, a different skill each time,
 *   and gains it at that level.
 * - `service-skills`: every entry of the Service Skills table of the career `career`, at level 0.
 */
export const EducationSkillsSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pick'),
    levels: z.array(z.int().min(0)).min(1, 'must list at least one level'),
    list: z.array(nonEmpty).min(1, 'must list at least one skill'),
  }),
  z.strictObject({ kind: z.literal('service-skills'), career: nonEmpty }),
])

/** The graduation check: a characteristic check, `honoursAt` (a total at or above it gives honours) and `dms`. */
export const GraduationSchema = z.strictObject({
  ...CheckSchema.shape,
  honoursAt: z.int().min(0).max(30),
  dms: z.array(CharacteristicDMSchema).optional(),
})

/**
 * What graduation gives:
 * - `raisePickedSkills`: levels added to each skill picked on entry (for a `pick` education).
 * - `effects`: applied on graduation; `honoursEffects`: applied as well with honours.
 * - `qualificationDM`: a DM on the qualification roll of the next career when it is one of `careers`
 *   (`honoursDM` with honours).
 * - `commission`: a commission roll before the first term of the next career when it is one of `careers`,
 *   with `dm`, or `honoursDM` (when set) with honours; with `honoursAutomatic`, honours pass it with no roll,
 *   and `honoursDM` must not be set.
 */
export const EducationBenefitsSchema = z.strictObject({
  raisePickedSkills: z.int().min(1).optional(),
  effects: EffectsSchema,
  honoursEffects: EffectsSchema,
  qualificationDM: z
    .strictObject({ careers: z.array(nonEmpty).min(1, 'must list at least one career'), dm: z.int(), honoursDM: z.int() })
    .optional(),
  commission: z
    .strictObject({
      careers: z.array(nonEmpty).min(1, 'must list at least one career'),
      dm: z.int(),
      honoursDM: z.int().optional(),
      honoursAutomatic: z.boolean().optional(),
    })
    .refine((c) => !(c.honoursAutomatic === true && c.honoursDM !== undefined), {
      message: 'must not set honoursDM with honoursAutomatic, since honours then pass with no roll',
      path: ['honoursDM'],
    })
    .optional(),
})

/**
 * An academy's tie to a career: a graduate enters `career` with no qualification roll and raises
 * `serviceSkillsOnEntry` of its Service Skills to level 1. A character who fails graduation still enters
 * with no roll, but with no commission roll, unless the graduation dice (before DMs) were at or below
 * `failedEntryUnlessAtOrBelow`.
 */
export const TiedCareerSchema = z.strictObject({
  career: nonEmpty,
  serviceSkillsOnEntry: z.int().min(0),
  failedEntryUnlessAtOrBelow: z.int().min(2).max(12),
})

/** One education entry. Unknown keys are rejected. The events table covers 2 to 12. */
export const EducationSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  source: nonEmpty,
  summary: nonEmpty,
  entry: EducationEntrySchema,
  skills: EducationSkillsSchema,
  onEntry: EffectsSchema,
  events: z.array(EventEntrySchema).superRefine(coversRolls(2, 12)),
  graduation: GraduationSchema,
  benefits: EducationBenefitsSchema,
  tiedCareer: TiedCareerSchema.optional(),
})
/** A validated education entry, as described by EducationSchema. */
export type EducationDefinition = z.infer<typeof EducationSchema>

/**
 * Checks parsed JSON against EducationSchema. Returns the typed entry, or one message per problem in the
 * form "path: message". It does not throw for any input.
 */
export function parseEducation(data: unknown): { ok: true; education: EducationDefinition } | { ok: false; errors: string[] } {
  const result = EducationSchema.safeParse(data)
  if (result.success) return { ok: true, education: result.data }
  return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}

/**
 * Parses every file in `files` (file name → parsed JSON) with parseEducation, in file name order by UTF-16
 * code units. Files that fail are left out of `education`, and their problems are added to `errors` with the
 * file name in front. An entry whose id an earlier file already used is also left out and reported.
 */
export function loadEducation(files: Record<string, unknown>): { education: EducationDefinition[]; errors: string[] } {
  const education: EducationDefinition[] = []
  const errors: string[] = []
  const idOwners = new Map<string, string>()
  for (const [file, data] of Object.entries(files).sort(([a], [b]) => compareCodeUnits(a, b))) {
    const result = parseEducation(data)
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `${file}: ${e}`))
      continue
    }
    const owner = idOwners.get(result.education.id)
    if (owner) {
      errors.push(`${file}: id "${result.education.id}" is already used by ${owner}`)
      continue
    }
    idOwners.set(result.education.id, file)
    education.push(result.education)
  }
  return { education, errors }
}
