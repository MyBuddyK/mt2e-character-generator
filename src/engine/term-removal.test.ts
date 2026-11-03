import { describe, expect, it } from 'vitest'
import { parseCareerPack } from './career-pack'
import { parseCareer, type CareerDefinition } from './career-schema'
import { newCharacter } from './character'
import { CHARACTERISTICS, type Characteristic } from './characteristics'
import { current } from './overridable'
import { finishCareer, policyChoice } from './policy'
import { buildCareer, EMPTY_INPUT, removeLastTerm, type CareerData, type CareerInput } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'
import validPack from '../../e2e/fixtures/valid-pack.json'

// Unit tests for removeLastTerm (docs/features/term-removal.md).

/** Returns the sample career parsed with parseCareer, with `id` and `name` replaced when given, or throws if it does not pass. */
function sampleCareer(id = 'sample-sanitation', name = 'Sample: Orbital Sanitation'): CareerDefinition {
  const result = parseCareer({ ...sampleCareerJson, id, name })
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

/** Returns the careers of e2e/fixtures/valid-pack.json parsed with parseCareerPack, or throws if it is rejected. */
function validPackCareers(): CareerDefinition[] {
  const result = parseCareerPack(validPack)
  if (!result.ok) throw new Error(result.reason)
  return result.careers
}

/** Returns the current value of each characteristic of the character rolled from `seed`. */
function baseFor(seed: string): Record<Characteristic, number> {
  const { characteristics } = newCharacter(seed)
  const base: Record<Characteristic, number> = { STR: 0, DEX: 0, END: 0, INT: 0, EDU: 0, SOC: 0 }
  for (const key of CHARACTERISTICS) base[key] = current(characteristics[key])
  return base
}

/** Returns an input that picks `career` and its first assignment, with no other choices. */
function startOf(career: CareerDefinition): CareerInput {
  const assignment = career.assignments[0]
  if (!assignment) throw new Error(`${career.id} has no assignment`)
  return { ...EMPTY_INPUT, choices: { 'start.career': career.id, 'start.assignment': assignment.id } }
}

/**
 * Returns `input` with choices made by policyChoice, one at a time from the start, until the career
 * has `terms` terms and the after-term choice is pending. This is the reference for "stopped at the
 * end of that term". Throws when the career reaches no such point within 1000 choices.
 */
function playTo(seed: string, base: Record<Characteristic, number>, input: CareerInput, data: CareerData, terms: number): CareerInput {
  let next = input
  for (let i = 0; i < 1000; i += 1) {
    const result = buildCareer(seed, base, next, data)
    if (result.pending?.kind === 'next' && result.terms.length === terms) return next
    const pending = result.pending
    if (!pending || pending.kind === 'start') break
    const answer = policyChoice(pending, result, data.rules.termLimit, seed)
    if (answer === undefined) break
    next = { ...next, choices: { ...next.choices, [pending.key]: answer } }
  }
  throw new Error(`${seed}: no pause after term ${terms}`)
}

/** Returns the input removeLastTerm gives for these arguments, or undefined when it removes nothing. */
function removeInput(seed: string, base: Record<Characteristic, number>, input: CareerInput, data: CareerData): CareerInput | undefined {
  return removeLastTerm(seed, base, input, data)?.input
}

/** Seeds `remove-0` to `remove-39`, a fixed list so a failure names a seed that reproduces it. */
const SEEDS = Array.from({ length: 40 }, (_, i) => `remove-${i}`)

// Removing terms one at a time from characters made by Finish career, compared with characters that
// stopped at the end of each earlier term.
describe('removeLastTerm sweep', () => {
  // For each seed and each career in the sample career and the valid fixture pack, runs Finish career,
  // then removes the most recent term until none are left. After each removal that leaves k terms,
  // expects the removed term's number to be k + 1, the input and the built career to equal those of a character played with the same policy
  // that stopped at the end of term k, and the terms to equal the first k terms of the full career.
  // After the last removal, expects an empty input with the start choice pending.
  // Criteria: TR-2, TR-3, TR-4.
  it('each removal gives the character that stopped at the end of the term before', () => {
    const careers = [sampleCareer(), ...validPackCareers()]
    const data: CareerData = { careers, rules: sampleRules }
    let removals = 0
    for (const career of careers) {
      for (const seed of SEEDS) {
        const base = baseFor(seed)
        const full = finishCareer(seed, base, startOf(career), data)
        const fullTerms = buildCareer(seed, base, full, data).terms
        let input = full
        for (let k = fullTerms.length - 1; k >= 0; k -= 1) {
          const removal = removeLastTerm(seed, base, input, data)
          if (removal === undefined) throw new Error(`${career.id} ${seed}: nothing removed with ${k + 1} terms`)
          expect(removal.removed, `${career.id} ${seed}`).toBe(k + 1)
          input = removal.input
          removals += 1
          const result = buildCareer(seed, base, input, data)
          const label = `${career.id} ${seed} back to ${k} terms`
          expect(result.terms, label).toEqual(fullTerms.slice(0, k))
          // With no terms left the reference is the empty input, whose build has the start choice pending.
          const reference = k === 0 ? EMPTY_INPUT : playTo(seed, base, startOf(career), data, k)
          expect(input, label).toEqual(reference)
          expect(result, label).toEqual(buildCareer(seed, base, reference, data))
          expect(result.pending?.kind, label).toBe(k === 0 ? 'start' : 'next')
        }
        expect(removeInput(seed, base, input, data), `${career.id} ${seed}`).toBeUndefined()
      }
    }
    expect(removals).toBeGreaterThan(SEEDS.length)
  })

  // For each seed whose sample career character finishes with two or more terms, runs Finish career,
  // removes the most recent term, runs Finish career again, and expects the same input as the first
  // run: Finish career goes on from the end of the term before and plays the removed term again with
  // the same dice. (Removing a first term goes back to the career pick, which Finish career does not make.)
  // Criteria: TR-5.
  it('Finish career after a removal goes on from the end of the term before', () => {
    const career = sampleCareer()
    const data: CareerData = { careers: [career], rules: sampleRules }
    let checked = 0
    for (const seed of SEEDS) {
      const base = baseFor(seed)
      const full = finishCareer(seed, base, startOf(career), data)
      if (buildCareer(seed, base, full, data).terms.length < 2) continue
      const removed = removeInput(seed, base, full, data) ?? EMPTY_INPUT
      expect(finishCareer(seed, base, removed, data), seed).toEqual(full)
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })
})

const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
const SEED = 'remove'
const DATA: CareerData = { careers: [sampleCareer(), sampleCareer('second', 'Second career')], rules: sampleRules }

/** Choices and rolls for two terms of the sample career that pass qualification and survival, with term 1 continued. */
const TWO_TERMS: CareerInput = {
  choices: {
    'start.career': 'sample-sanitation',
    'start.assignment': 'debris-sweep',
    'term-1.skill-0.table': 'serviceSkills',
    'term-1.next': 'continue',
    'term-2.skill-0.table': 'personalDevelopment',
  },
  rolls: { qualification: 12, 'term-1.survival': 12, 'term-1.advancement': 2, 'term-2.survival': 11, 'term-2.advancement': 2 },
  outcomes: {},
  notes: { 'term-1': 'first term note', 'term-2': 'second term note' },
}

/** Returns TWO_TERMS with `choices` added. */
function withTwo(choices: Record<string, string>): CareerInput {
  return { ...TWO_TERMS, choices: { ...TWO_TERMS.choices, ...choices } }
}

// Single removals from hand-written inputs: what is removed and what is kept.
describe('removeLastTerm', () => {
  // Builds a career with only the start choice made (no terms yet) and expects undefined.
  // Criteria: TR-3.
  it('returns undefined when the career has no terms', () => {
    expect(removeInput(SEED, BASE, EMPTY_INPUT, DATA)).toBeUndefined()
    expect(removeInput(SEED, BASE, { ...EMPTY_INPUT, choices: { 'start.career': 'sample-sanitation' } }, DATA)).toBeUndefined()
  })

  // Removes term 2 of TWO_TERMS and expects term 1's choices, rolls and note kept, term 2's choices,
  // rolls and note gone, term-1.next gone, and the after-term choice of term 1 pending.
  // Criteria: TR-2, TR-7.
  it('removes the term’s choices, overrides and note and keeps the earlier term’s', () => {
    const removed = removeInput(SEED, BASE, TWO_TERMS, DATA)
    expect(removed).toEqual({
      choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep', 'term-1.skill-0.table': 'serviceSkills' },
      rolls: { qualification: 12, 'term-1.survival': 12, 'term-1.advancement': 2 },
      outcomes: {},
      notes: { 'term-1': 'first term note' },
    })
    const result = buildCareer(SEED, BASE, removed ?? EMPTY_INPUT, DATA)
    expect(result.terms.map((t) => t.key)).toEqual(['term-1'])
    expect(result.pending).toEqual({ kind: 'next', key: 'term-1.next', forced: undefined, reason: undefined })
    expect(result.age).toBe(sampleRules.startingAge + sampleRules.termLength)
  })

  // Builds TWO_TERMS, removes term 2, and expects the skills, characteristic changes, rank and age to
  // equal those of the input that stops after term 1 with no term 2 keys.
  // Criteria: TR-2.
  it('undoes the skills, rank and age the removed term added', () => {
    const removed = buildCareer(SEED, BASE, removeInput(SEED, BASE, TWO_TERMS, DATA) ?? EMPTY_INPUT, DATA)
    const oneTerm = buildCareer(
      SEED,
      BASE,
      { ...EMPTY_INPUT, choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep', 'term-1.skill-0.table': 'serviceSkills' }, rolls: { qualification: 12, 'term-1.survival': 12, 'term-1.advancement': 2 } },
      DATA,
    )
    const two = buildCareer(SEED, BASE, TWO_TERMS, DATA)
    expect(two.age).toBeGreaterThan(oneTerm.age)
    expect(removed.skills).toEqual(oneTerm.skills)
    expect(removed.characteristicChanges).toEqual(oneTerm.characteristicChanges)
    expect(removed.rank).toBe(oneTerm.rank)
    expect(removed.age).toBe(oneTerm.age)
    expect(removed.cash).toBe(oneTerm.cash)
  })

  // Removes term 2, then picks Continue in career and the same skill table, and expects a term 2 equal
  // to the one TWO_TERMS builds without its term 2 roll overrides (the same dice, overrides gone).
  // Then picks Leave career instead and expects one term and the first benefit roll pending.
  // Criteria: TR-5.
  it('continue or leave after a removal goes on from the end of the term before', () => {
    const removed = removeInput(SEED, BASE, TWO_TERMS, DATA) ?? EMPTY_INPUT
    const again = buildCareer(
      SEED,
      BASE,
      { ...removed, choices: { ...removed.choices, 'term-1.next': 'continue', 'term-2.skill-0.table': 'personalDevelopment' } },
      DATA,
    )
    const unrolled = buildCareer(SEED, BASE, { ...TWO_TERMS, rolls: { qualification: 12, 'term-1.survival': 12, 'term-1.advancement': 2 } }, DATA)
    expect(again.terms).toHaveLength(2)
    expect(again.terms[1]).toEqual(unrolled.terms[1])
    const left = buildCareer(SEED, BASE, { ...removed, choices: { ...removed.choices, 'term-1.next': 'leave' } }, DATA)
    expect(left.pending?.kind).toBe('benefit')
    expect(left.terms).toHaveLength(1)
  })

  // Musters out after term 2 with one benefit roll, then removes term 2, and expects the benefit choice
  // gone, no benefits, and the character not finished.
  // Criteria: TR-6.
  it('removes the mustering out that followed the term', () => {
    const mustered = withTwo({ 'term-2.next': 'leave', 'benefit-0': 'cash', 'benefit-1': 'benefit' })
    expect(buildCareer(SEED, BASE, mustered, DATA).finished).toBe(true)
    const removed = removeInput(SEED, BASE, mustered, DATA) ?? EMPTY_INPUT
    expect(Object.keys(removed.choices).filter((k) => k.startsWith('benefit-') || k === 'term-1.next')).toEqual([])
    const result = buildCareer(SEED, BASE, removed, DATA)
    expect(result.benefits).toEqual([])
    expect(result.finished).toBe(false)
    expect(result.pending?.kind).toBe('next')
  })

  // Musters out after term 2, starts a second career and serves its first term, then removes that term,
  // and expects one career, no "career-2." keys, no benefits, and term 2's after-term choice pending.
  // Criteria: TR-6.
  it('removes a later career and the mustering out before it', () => {
    const twoCareers = withTwo({
      'term-2.next': 'leave',
      'benefit-0': 'cash',
      'benefit-1': 'benefit',
      'career-2.start.career': 'second',
      'career-2.start.assignment': 'debris-sweep',
      'career-2.term-1.skill-0.table': 'serviceSkills',
    })
    const withRolls: CareerInput = { ...twoCareers, rolls: { ...twoCareers.rolls, 'career-2.qualification': 12, 'career-2.term-1.survival': 12 } }
    const before = buildCareer(SEED, BASE, withRolls, DATA)
    expect(before.runs).toHaveLength(2)
    expect(before.terms[2]?.key).toBe('career-2.term-1')
    const removed = removeInput(SEED, BASE, withRolls, DATA) ?? EMPTY_INPUT
    const keys = [...Object.keys(removed.choices), ...Object.keys(removed.rolls)]
    expect(keys.filter((k) => k.startsWith('career-2.') || k.startsWith('benefit-') || k === 'term-2.next')).toEqual([])
    const result = buildCareer(SEED, BASE, removed, DATA)
    expect(result.runs).toHaveLength(1)
    expect(result.benefits).toEqual([])
    expect(result.pending).toEqual({ kind: 'next', key: 'term-2.next', forced: undefined, reason: undefined })
  })

  // Removes the only term of a one-term career and expects an empty input with the notes of term 1
  // removed and the start choice pending.
  // Criteria: TR-4.
  it('removing the first term goes back to the career pick', () => {
    const removed = removeInput(SEED, BASE, removeInput(SEED, BASE, TWO_TERMS, DATA) ?? EMPTY_INPUT, DATA)
    expect(removed).toEqual(EMPTY_INPUT)
    expect(buildCareer(SEED, BASE, removed ?? TWO_TERMS, DATA).pending?.kind).toBe('start')
  })

  // Gives TWO_TERMS notes for terms 3 and 4 as well (left by terms an earlier change dropped), plus
  // a term 1 survival override that fails, so the career has one term. Removes term 1 and expects
  // every note gone and removed set to 1; removes term 2 of TWO_TERMS with the same extra notes and
  // expects only the term 1 note kept.
  // Criteria: TR-7.
  it('removes notes left by later terms that an earlier change dropped', () => {
    const stale = { 'term-3': 'old third', 'term-4': 'old fourth' }
    const oneTerm: CareerInput = {
      ...TWO_TERMS,
      rolls: { ...TWO_TERMS.rolls, 'term-1.survival': 2 },
      notes: { ...TWO_TERMS.notes, ...stale },
    }
    expect(buildCareer(SEED, BASE, oneTerm, DATA).terms).toHaveLength(1)
    expect(removeLastTerm(SEED, BASE, oneTerm, DATA)).toEqual({ input: EMPTY_INPUT, removed: 1 })
    const removal = removeLastTerm(SEED, BASE, { ...TWO_TERMS, notes: { ...TWO_TERMS.notes, ...stale } }, DATA)
    expect(removal?.removed).toBe(2)
    expect(removal?.input.notes).toEqual({ 'term-1': 'first term note' })
  })
})
