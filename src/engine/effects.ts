import { z } from 'zod'
import { CHARACTERISTICS } from './characteristics'

/**
 * Structured effects that the career engine applies for an event, mishap, rank or aging result.
 * Anything an entry needs beyond this list stays in its free-text summary or bonus, which the app
 * shows as a note for the player to apply by hand.
 */

/** The skill tables a career can have. `assignment` is the skill table of the current assignment. */
export const SKILL_TABLES = ['personalDevelopment', 'serviceSkills', 'assignment', 'advancedEducation'] as const
/** One of SKILL_TABLES. */
export type SkillTableKey = (typeof SKILL_TABLES)[number]

const nonEmpty = z.string().trim().min(1, 'must be a non-empty string')

/**
 * One effect:
 * - `skill`: gain a level in a skill. With one option it is applied; with several the player picks
 *   one. With `level`, the skill is raised to at least that level instead of by one.
 * - `roll-table`: roll once on one of the career's skill tables.
 * - `dm-next`: a DM on the next advancement or qualification roll.
 * - `benefit-dm`: a DM on the next mustering-out benefit roll.
 * - `extra-benefit`: extra mustering-out benefit rolls (one when `count` is left out).
 * - `characteristic`: add `change` (which may be negative) to one characteristic.
 * - `leave-career`: the character leaves the career at the end of the term.
 * - `mishap`: roll on the mishap table without leaving the career.
 */
export const EffectSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('skill'),
    options: z.array(nonEmpty).min(1, 'must list at least one skill'),
    level: z.int().min(0).optional(),
  }),
  z.strictObject({ type: z.literal('roll-table'), table: z.enum(SKILL_TABLES) }),
  z.strictObject({ type: z.literal('dm-next'), roll: z.enum(['advancement', 'qualification']), dm: z.int() }),
  z.strictObject({ type: z.literal('benefit-dm'), dm: z.int() }),
  z.strictObject({ type: z.literal('extra-benefit'), count: z.int().min(1).optional() }),
  z.strictObject({ type: z.literal('characteristic'), characteristic: z.enum(CHARACTERISTICS), change: z.int() }),
  z.strictObject({ type: z.literal('leave-career') }),
  z.strictObject({ type: z.literal('mishap') }),
])
/** One effect, as described by EffectSchema. */
export type Effect = z.infer<typeof EffectSchema>

/** An optional list of effects, as used on event, mishap, rank and aging entries. */
export const EffectsSchema = z.array(EffectSchema).optional()
