import { z } from 'zod'
import { CHARACTERISTICS } from './characteristics'
import { SKILL_TABLES, EffectsSchema } from './effects'

/**
 * The values that apply to every career (docs/features/career-terms.md, decision 1). They come from
 * the `rules` object of a career pack, or from the invented src/data/rules/sample-rules.json. No
 * rulebook value is written in code.
 */

/**
 * One aging table row: the total it answers to, a short summary, and the effects applied. Totals
 * below the lowest row use the lowest row, and totals above the highest use the highest.
 */
export const AgingEntrySchema = z.strictObject({
  roll: z.int(),
  summary: z.string().trim().min(1, 'must be a non-empty string'),
  effects: EffectsSchema,
})
/** One aging row, as described by AgingEntrySchema. */
export type AgingEntry = z.infer<typeof AgingEntrySchema>

/** Returns a zod check that adds an issue when the `roll` values are not consecutive whole numbers, each once. */
function consecutiveRolls(entries: { roll: number }[], ctx: z.RefinementCtx) {
  const rolls = entries.map((e) => e.roll).sort((a, b) => a - b)
  if (rolls.some((r, i) => i > 0 && r !== (rolls[i - 1] ?? r) + 1)) {
    ctx.addIssue({ code: 'custom', message: `roll values must be consecutive, each once; got [${rolls.join(', ')}]` })
  }
}

/** The full rules object. Unknown keys are rejected. */
export const RulesSchema = z.strictObject({
  /** Where the values come from, e.g. "Core Rulebook p.XX". */
  source: z.string().trim().min(1, 'must be a non-empty string'),
  /** Age in years when the first term starts. */
  startingAge: z.int().min(0),
  /** Years in one term. */
  termLength: z.int().min(1),
  /** The most terms that Finish career plays in one career; it leaves the career after that many. */
  termLimit: z.int().min(1),
  /** How many skill table rolls a term gives, and how many more a successful advancement gives. */
  skillRolls: z.strictObject({ perTerm: z.int().min(0), onAdvancement: z.int().min(0) }),
  /** The skill table the first term of a career trains in, and the level each skill on it starts at. */
  basicTraining: z.strictObject({ table: z.enum(SKILL_TABLES), level: z.int().min(0) }),
  /** The lowest EDU that allows rolls on the advancedEducation table. */
  advancedEducationMinEDU: z.int().min(0),
  /**
   * Optional. `dmPerPreviousCareer`: a DM on each qualification roll for every career the character
   * has already served.
   */
  qualification: z.strictObject({ dmPerPreviousCareer: z.int() }).optional(),
  /**
   * Optional. The Draft table, rolled on 1D when qualification fails and the player takes the Draft
   * (once per character). Each row names a career id and, optionally, an assignment id; without one
   * the player picks the assignment.
   */
  draft: z
    .array(z.strictObject({ roll: z.int(), career: z.string().trim().min(1, 'must be a non-empty string'), assignment: z.string().trim().min(1, 'must be a non-empty string').optional() }))
    .min(1, 'must have at least one row')
    .superRefine(consecutiveRolls)
    .optional(),
  /** Optional. The id of the career offered without a qualification roll when qualification fails. */
  fallbackCareer: z.string().trim().min(1, 'must be a non-empty string').optional(),
  /**
   * Optional commission rules: a commission roll is allowed in a career's first term, or in any term
   * when SOC is at least `anyTermFromSOC`, with `dmPerLaterTerm` for each term after the first.
   */
  commission: z.strictObject({ anyTermFromSOC: z.int().min(0), dmPerLaterTerm: z.int() }).optional(),
  /** Optional. `failOnNatural`: survival fails when the dice (before DMs) are at or below this value. */
  survival: z.strictObject({ failOnNatural: z.int().min(0).optional() }).optional(),
  /**
   * Optional advancement rules. `leaveAtOrBelowTerms`: an advancement total at or below the number of
   * terms served in the career ends the career after the term. `stayOnNatural`: dice (before DMs) at
   * or above this value mean the character must continue.
   */
  advancement: z
    .strictObject({ leaveAtOrBelowTerms: z.boolean().optional(), stayOnNatural: z.int().min(2).optional() })
    .optional(),
  /**
   * Optional skill limits. `maxLevel`: a gain that would take a skill above this level is lost.
   * `totalPerIntEdu`: a gain that would take the sum of all skill levels above this value times
   * (INT + EDU) is lost.
   */
  skillLimits: z.strictObject({ maxLevel: z.int().min(0).optional(), totalPerIntEdu: z.int().min(0).optional() }).optional(),
  /**
   * Aging: from which term it is rolled, how many dice, the DM added per term served (usually
   * negative), and the table. Optional `crisis`: when aging takes a characteristic to 0 or below, the
   * player chooses between medical care costing `costDice` D × `costPerDie` credits (characteristics at
   * 0 or below go back to 1, and every later qualification roll fails) and the character's death.
   */
  aging: z.strictObject({
    fromTerm: z.int().min(1),
    dice: z.int().min(1),
    dmPerTerm: z.int(),
    table: z.array(AgingEntrySchema).min(1, 'must have at least one row').superRefine(consecutiveRolls),
    crisis: z.strictObject({ costDice: z.int().min(1), costPerDie: z.int().min(0) }).optional(),
  }),
  /**
   * Optional anagathics. The player can take them in any term: starting needs a 2D check of
   * `characteristic` against `target`. While taken, each term costs `costDice` D × `costPerDie` credits
   * (taken from cash), needs a second survival roll, and adds the number of terms taken in a row to the
   * aging roll. A term without them after a term with them rolls aging at once. `prisonOnNatural`: dice at
   * or below it on the starting check are flagged for the player to apply by hand.
   */
  anagathics: z
    .strictObject({
      characteristic: z.enum(CHARACTERISTICS),
      target: z.int().min(0).max(20),
      costDice: z.int().min(1),
      costPerDie: z.int().min(0),
      prisonOnNatural: z.int().min(2).optional(),
    })
    .optional(),
  /**
   * Mustering out: benefit rolls per term served, extra rolls for reaching a rank, a DM on cash and
   * benefit rolls from a rank, and the most cash rolls one character may take. Optional:
   * `mishapLosesTerm` true means a term that ends the career with a mishap gives no benefit roll, and
   * `cashSkillDM` gives a DM on cash rolls to a character who has `skill` at any level.
   */
  benefits: z.strictObject({
    perTerm: z.int().min(0),
    rankExtra: z.array(z.strictObject({ minRank: z.int().min(0), extra: z.int().min(0) })),
    rankBenefitDM: z.array(z.strictObject({ minRank: z.int().min(0), dm: z.int() })),
    cashRollLimit: z.int().min(0),
    mishapLosesTerm: z.boolean().optional(),
    cashSkillDM: z.strictObject({ skill: z.string().trim().min(1, 'must be a non-empty string'), dm: z.int() }).optional(),
  }),
})
/** A validated rules object, as described by RulesSchema. */
export type Rules = z.infer<typeof RulesSchema>
