import { z } from 'zod'
import { CHARACTERISTICS } from './characteristics'

/**
 * Structured effects that the career engine applies for an event, mishap, rank or aging result.
 * Anything an entry needs beyond this list stays in its free-text summary or bonus, which the app
 * shows as a note for the player to apply by hand.
 */

/**
 * The skill tables a career can have. `assignment` is the skill table of the current assignment.
 * `officer` is offered only to a commissioned officer.
 */
export const SKILL_TABLES = ['personalDevelopment', 'serviceSkills', 'assignment', 'advancedEducation', 'officer'] as const
/** One of SKILL_TABLES. */
export type SkillTableKey = (typeof SKILL_TABLES)[number]

const nonEmpty = z.string().trim().min(1, 'must be a non-empty string')

/**
 * The kinds of later roll a `dm-later` effect can be applied to: a qualification, survival,
 * advancement, commission or aging roll, or a mustering-out roll on either table ("benefit").
 */
export const ROLL_KINDS = ['qualification', 'survival', 'advancement', 'commission', 'aging', 'benefit'] as const
/** One of ROLL_KINDS. */
export type RollKind = (typeof ROLL_KINDS)[number]

/**
 * One effect:
 * - `skill`: gain a level in a skill. With one option it is applied; with several the player picks
 *   one. With `level`, the skill is raised to at least that level instead of by one.
 * - `roll-table`: roll once on one of the career's skill tables.
 * - `dm-next`: a DM on the next advancement, qualification or survival roll, applied by the engine. An
 *   advancement DM also applies to a commission roll made instead of the advancement roll.
 * - `dm-later`: a DM the player applies by hand to one later roll they pick, of a kind in `rolls`
 *   (any kind in ROLL_KINDS when left out). Until the player picks a roll it is not applied.
 * - `benefit-dm`: a DM on the next mustering-out benefit roll.
 * - `extra-benefit`: extra mustering-out benefit rolls (one when `count` is left out).
 * - `characteristic`: add `change` (which may be negative) to one characteristic.
 * - `leave-career`: the character leaves the career at the end of the term.
 * - `mishap`: roll on the mishap table without leaving the career.
 * - `promote`: this term's advancement roll passes without being rolled.
 * - `stay-in-career`: on a mishap, the career does not end because of the mishap.
 * - `keep-benefit`: on a mishap, the term still gives its benefit roll.
 * - `reduce`: reduce characteristics picked by the player from `characteristics` (each listed once), a different one for
 *   each value in `amounts` (for example three physical characteristics by 2, 2 and 1). Values beyond
 *   the number of characteristics listed are not applied.
 * - `wager`: the player may wager benefit rolls earned so far in this career (at most `maxWager`, when
 *   set) on a 2D roll with one of `skills` (skill level as the DM, -3 when untrained) against `target`.
 *   Success gains half the wager in extra benefit rolls, rounded up; failure loses the wager. With
 *   `gainUsedSkill`, the skill used gains a level either way. Wagering 0 skips the roll.
 * - `life-event`: roll on the Life Events table in the rules (`rules.lifeEvents`) and apply the entry in
 *   the same term, as its own step after the step that gave it. With no table in the rules it is a note.
 * - `ship-shares`: gain `count` ship shares, counted on the character.
 * - `choice`: the player picks one of `options` (at least two, each label once), and the engine
 *   applies that option's effects. An option's effects can be any effect but another `choice`.
 *
 * PLAIN_EFFECTS lists every effect but `choice`.
 */
const PLAIN_EFFECTS = [
  z.strictObject({
    type: z.literal('skill'),
    options: z.array(nonEmpty).min(1, 'must list at least one skill'),
    level: z.int().min(0).optional(),
  }),
  z.strictObject({ type: z.literal('roll-table'), table: z.enum(SKILL_TABLES) }),
  z.strictObject({ type: z.literal('dm-next'), roll: z.enum(['advancement', 'qualification', 'survival']), dm: z.int() }),
  z.strictObject({
    type: z.literal('dm-later'),
    dm: z.int(),
    rolls: z.array(z.enum(ROLL_KINDS)).min(1, 'must list at least one roll kind').optional(),
  }),
  z.strictObject({ type: z.literal('benefit-dm'), dm: z.int() }),
  z.strictObject({ type: z.literal('extra-benefit'), count: z.int().min(1).optional() }),
  z.strictObject({ type: z.literal('characteristic'), characteristic: z.enum(CHARACTERISTICS), change: z.int() }),
  z.strictObject({ type: z.literal('leave-career') }),
  z.strictObject({ type: z.literal('mishap') }),
  z.strictObject({ type: z.literal('promote') }),
  z.strictObject({ type: z.literal('stay-in-career') }),
  z.strictObject({ type: z.literal('keep-benefit') }),
  z.strictObject({ type: z.literal('life-event') }),
  z.strictObject({ type: z.literal('ship-shares'), count: z.int().min(1) }),
  z.strictObject({
    type: z.literal('reduce'),
    characteristics: z
      .array(z.enum(CHARACTERISTICS))
      .min(1, 'must list at least one characteristic')
      .refine((list) => new Set(list).size === list.length, 'must not list a characteristic twice'),
    amounts: z.array(z.int().min(1)).min(1, 'must list at least one amount'),
  }),
  z.strictObject({
    type: z.literal('wager'),
    skills: z.array(nonEmpty).min(1, 'must list at least one skill'),
    target: z.int().min(0).max(20),
    maxWager: z.int().min(1).optional(),
    gainUsedSkill: z.boolean().optional(),
  }),
] as const

/** One effect other than `choice`: the effects a `choice` option can list. */
export const PlainEffectSchema = z.discriminatedUnion('type', PLAIN_EFFECTS)
/** One effect other than `choice`, as described by PlainEffectSchema. */
export type PlainEffect = z.infer<typeof PlainEffectSchema>

/** One option of a `choice` effect: the label shown on its button, and the effects applied when it is picked. */
export const ChoiceOptionSchema = z.strictObject({ label: nonEmpty, effects: z.array(PlainEffectSchema).optional() })
/** One option of a `choice` effect, as described by ChoiceOptionSchema. */
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>

/** One effect: one of PLAIN_EFFECTS or a `choice`, each described in the list above PLAIN_EFFECTS. */
export const EffectSchema = z.discriminatedUnion('type', [
  ...PLAIN_EFFECTS,
  z.strictObject({
    type: z.literal('choice'),
    options: z
      .array(ChoiceOptionSchema)
      .min(2, 'must list at least two options')
      .refine((list) => new Set(list.map((o) => o.label)).size === list.length, 'must not use an option label twice'),
  }),
])
/** One effect, as described by EffectSchema. */
export type Effect = z.infer<typeof EffectSchema>

/** An optional list of effects, as used on event, mishap, rank and aging entries. */
export const EffectsSchema = z.array(EffectSchema).optional()
