import type { Characteristic } from './characteristics'
import { buildCareer, type CareerData, type CareerInput, type CareerResult, type PendingChoice } from './terms'

/**
 * The Finish career policy (docs/features/career-terms.md, decision 7, and
 * docs/features/career-rules.md), shown to the player as POLICY_SUMMARY.
 */

/** A one-line description of what policyChoice picks, shown next to the Finish career button. */
export const POLICY_SUMMARY =
  'Finish career keeps this career and assignment, rolls on the last skill table the character can use, picks the first option when a skill is a choice, and continues term after term until the character is forced out (by a mishap, an event or the advancement roll) or reaches the term limit in the rules. It stops at an ageing crisis. When the career ends it takes cash for the first benefit roll and benefits after that.'

/**
 * Returns the answer the policy gives to `pending`, given the career so far and the term limit:
 * the last skill table offered, the first skill option, the forced answer when a rule forces the
 * after-term choice, "continue" until `termLimit` terms are done and "leave" after that, and "cash" for
 * the first benefit roll when cash is allowed ("benefit" otherwise). Returns undefined for the start
 * choice, which the player must make.
 */
export function policyChoice(pending: PendingChoice, result: CareerResult, termLimit: number): string | undefined {
  switch (pending.kind) {
    case 'start':
      return undefined
    case 'skill-table':
      return pending.options[pending.options.length - 1]
    case 'skill-option':
      return pending.options[0]
    case 'next':
      if (pending.forced !== undefined) return pending.forced
      return result.terms.length >= termLimit ? 'leave' : 'continue'
    case 'benefit':
      return pending.index === 0 && pending.cashAllowed ? 'cash' : 'benefit'
  }
}

/**
 * Returns `input` with the remaining choices made by policyChoice, by building the career and
 * answering its pending choice until it has mustered out or is waiting for the start choice. It
 * stops early, leaving the after-term choice open, when that term's aging caused an ageing crisis.
 * Stops after 1000 choices as a guard against data that never finishes.
 */
export function finishCareer(
  seed: string,
  base: Record<Characteristic, number>,
  input: CareerInput,
  data: CareerData,
): CareerInput {
  let next: CareerInput = input
  for (let i = 0; i < 1000; i += 1) {
    const result = buildCareer(seed, base, next, data)
    if (!result.pending) return next
    if (result.pending.kind === 'next' && result.terms[result.terms.length - 1]?.ageingCrisis) return next
    const answer = policyChoice(result.pending, result, data.rules.termLimit)
    if (answer === undefined || result.pending.kind === 'start') return next
    next = { ...next, choices: { ...next.choices, [result.pending.key]: answer } }
  }
  return next
}
