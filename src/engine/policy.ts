import type { Characteristic } from './characteristics'
import { buildCareer, type CareerData, type CareerInput, type CareerResult, type PendingChoice } from './terms'

/**
 * The Generate the rest policy (docs/features/career-terms.md, decision 7), shown to the player as
 * POLICY_SUMMARY.
 */

/** A one-line description of what policyChoice picks, shown next to the Generate the rest button. */
export const POLICY_SUMMARY =
  'Generate the rest keeps this career and assignment, rolls on the last skill table the character can use, picks the first option when a skill is a choice, plays the number of terms you ask for (up to the term limit in the rules) unless a rule ends the career or forces it on, stops at an ageing crisis, and takes cash for the first benefit roll and benefits after that.'

/**
 * Returns how many terms of `result` are complete: every term when the career is waiting for the
 * after-term choice or has reached mustering out, otherwise every term but the one in progress.
 */
export function finishedTerms(result: CareerResult): number {
  const inProgress = result.pending !== undefined && result.pending.kind !== 'next' && result.pending.kind !== 'benefit'
  return Math.max(0, result.terms.length - (inProgress ? 1 : 0))
}

/**
 * Returns the most terms Generate the rest can add to `result`: the rules' `termLimit` minus the
 * finished terms, and never below 0.
 */
export function maxMoreTerms(result: CareerResult, termLimit: number): number {
  return Math.max(0, termLimit - finishedTerms(result))
}

/**
 * Returns the answer the policy gives to `pending`, given the career so far: the last skill table
 * offered, the first skill option, "continue" until `stopAfterTerms` terms are done ("leave" after
 * that; "muster" or "continue" when a rule forces it), and "cash" for the first benefit roll when cash
 * is allowed ("benefit" otherwise). Returns undefined for the start choice, which the player must make.
 */
export function policyChoice(pending: PendingChoice, result: CareerResult, stopAfterTerms: number): string | undefined {
  switch (pending.kind) {
    case 'start':
      return undefined
    case 'skill-table':
      return pending.options[pending.options.length - 1]
    case 'skill-option':
      return pending.options[0]
    case 'next':
      if (pending.forced !== undefined) return pending.forced
      return result.terms.length >= stopAfterTerms ? 'leave' : 'continue'
    case 'benefit':
      return pending.index === 0 && pending.cashAllowed ? 'cash' : 'benefit'
  }
}

/**
 * Returns `input` with the remaining choices made by policyChoice, by building the career and
 * answering its pending choice until it has mustered out or is waiting for the start choice.
 * `moreTerms` is how many more terms to finish (the rules' `termLimit` caps the total; leaving it out
 * plays up to that limit). It stops early, leaving the after-term choice open, when that term's aging
 * caused an ageing crisis. Stops after 1000 choices as a guard against data that never finishes.
 */
export function generateRest(
  seed: string,
  base: Record<Characteristic, number>,
  input: CareerInput,
  data: CareerData,
  moreTerms?: number,
): CareerInput {
  const first = buildCareer(seed, base, input, data)
  const stopAfter = Math.min(data.rules.termLimit, finishedTerms(first) + (moreTerms ?? data.rules.termLimit))
  let next: CareerInput = input
  for (let i = 0; i < 1000; i += 1) {
    const result = i === 0 ? first : buildCareer(seed, base, next, data)
    if (!result.pending) return next
    if (result.pending.kind === 'next' && result.terms[result.terms.length - 1]?.ageingCrisis) return next
    const answer = policyChoice(result.pending, result, stopAfter)
    if (answer === undefined || result.pending.kind === 'start') return next
    next = { ...next, choices: { ...next.choices, [result.pending.key]: answer } }
  }
  return next
}
