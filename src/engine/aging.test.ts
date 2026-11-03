import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import type { Effect } from './effects'
import { RulesSchema, type Rules } from './rules-schema'
import { policyChoice } from './policy'
import { buildCareer, EMPTY_INPUT, type CareerInput, type CareerResult, type PendingChoice } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'

// Unit tests for aging choices, ignoring aging, the ageing crisis and anagathics
// (docs/features/career-rules.md, "Aging"). Every career here is the invented sample career.

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
const SEED = 'careers'

/** Sample rules with aging from term 1, one aging row whose effects are `effects`, and `extra` fields. */
function agingRules(effects: Effect[], extra: Partial<Rules> = {}): Rules {
  return {
    ...sampleRules,
    aging: { ...sampleRules.aging, fromTerm: 1, table: [{ roll: 0, summary: 'Invented aging row.', effects }] },
    ...extra,
  }
}

const PHYSICAL: Effect = { type: 'reduce', characteristics: ['STR', 'DEX', 'END'], amounts: [2, 1] }

/** Returns an input that starts the sample career, survives term 1 and fails advancement, plus `choices` and `rolls`. */
function term1(choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerInput {
  return {
    ...EMPTY_INPUT,
    choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep', 'term-1.skill-0.table': 'serviceSkills', ...choices },
    rolls: { qualification: 12, 'term-1.survival': 12, 'term-1.advancement': 2, 'term-1.event': 9, ...rolls },
  }
}

/** Builds the sample career from `input` with `rules` and `base` (BASE by default). */
function build(input: CareerInput, rules: Rules, base = BASE): CareerResult {
  return buildCareer(SEED, base, input, { careers: [sampleCareer()], rules })
}

/** Returns the step of term `n` with `key` in `result`, or throws when it is missing. */
function step(result: CareerResult, n: number, key: string) {
  const found = result.terms[n - 1]?.steps.find((s) => s.key === key)
  if (!found) throw new Error(`no step ${key}`)
  return found
}

// Tests for the reduce effect that aging rows use.
describe('aging asks which characteristics to reduce', () => {
  // Rolls aging with "reduce two physical characteristics by 2 and 1" and expects the first pick (by
  // 2) from STR, DEX and END, then the second pick (by 1) from the two left.
  it('asks for a different characteristic for each amount', () => {
    const rules = agingRules([PHYSICAL])
    expect(build(term1(), rules).pending).toEqual({
      kind: 'characteristic',
      key: 'term-1.aging.effect-0.pick-0',
      options: ['STR', 'DEX', 'END'],
      amount: 2,
    })
    const second = build(term1({ 'term-1.aging.effect-0.pick-0': 'DEX' }), rules)
    expect(second.pending).toEqual({ kind: 'characteristic', key: 'term-1.aging.effect-0.pick-1', options: ['STR', 'END'], amount: 1 })
    const done = build(term1({ 'term-1.aging.effect-0.pick-0': 'DEX', 'term-1.aging.effect-0.pick-1': 'END' }), rules)
    expect(done.characteristicChanges).toMatchObject({ STR: 0, DEX: -2, END: -1 })
  })

  // Rolls aging with "reduce three physical characteristics by 1" and expects no choice and -1 on each.
  it('reduces every listed characteristic without asking when the amounts are the same', () => {
    const result = build(term1(), agingRules([{ type: 'reduce', characteristics: ['STR', 'DEX', 'END'], amounts: [1, 1, 1] }]))
    expect(result.pending?.kind).toBe('next')
    expect(result.characteristicChanges).toMatchObject({ STR: -1, DEX: -1, END: -1 })
  })

  // Ignores the aging roll and expects no pick, no change, and the ignored reason on the step.
  it('an ignored aging result is not applied', () => {
    const result = build(term1({ 'term-1.aging.ignore': 'ignore' }), agingRules([PHYSICAL]))
    expect(result.pending?.kind).toBe('next')
    expect(result.characteristicChanges).toMatchObject({ STR: 0, DEX: 0, END: 0 })
    const aging = step(result, 1, 'term-1.aging')
    expect(aging.ignore).toEqual({ key: 'term-1.aging.ignore', ignored: true })
    expect(aging.reasons).toContain('Ignored: this aging result is not applied.')
  })

  // Asks the policy about a characteristic choice under 40 seeds and expects only the options, and more than one of them.
  it('Finish career picks the characteristic at random', () => {
    const result = build(term1(), agingRules([PHYSICAL]))
    const pending: PendingChoice = { kind: 'characteristic', key: 'k', options: ['STR', 'DEX', 'END'], amount: 2 }
    const picks = new Set(Array.from({ length: 40 }, (_, i) => policyChoice(pending, result, 5, `seed-${i}`)))
    expect(picks.size).toBeGreaterThan(1)
    for (const p of picks) expect(['STR', 'DEX', 'END']).toContain(p)
  })
})

/** Rules where aging takes STR down by 1, with medical care for an ageing crisis at 1D × Cr10000. */
const CRISIS_RULES: Rules = {
  ...agingRules([{ type: 'reduce', characteristics: ['STR'], amounts: [1] }]),
  aging: { ...agingRules([{ type: 'reduce', characteristics: ['STR'], amounts: [1] }]).aging, crisis: { costDice: 1, costPerDie: 10000 } },
}
const WEAK = { ...BASE, STR: 1 }

// Tests for the ageing crisis with rules.aging.crisis set.
describe('the ageing crisis', () => {
  // Ages a character with STR 1 to STR 0 and expects the crisis choice naming STR.
  it('asks whether to pay for medical care', () => {
    expect(build(term1(), CRISIS_RULES, WEAK).pending).toEqual({
      kind: 'ageing-crisis',
      key: 'term-1.aging.crisis',
      characteristics: ['STR'],
      costDice: 1,
      costPerDie: 10000,
    })
  })

  // Pays for care with the cost dice set to 3, leaves, and expects STR back to 1, costs of Cr30000 taken
  // from cash, and the next career's qualification failing without a roll.
  it('medical care restores the characteristic, costs cash and fails later qualification rolls', () => {
    const input = term1(
      { 'term-1.aging.crisis': 'care', 'term-1.next': 'leave', 'benefit-0': 'cash', 'career-2.start.career': 'sample-sanitation', 'career-2.start.assignment': 'debris-sweep' },
      { 'term-1.aging.crisis-cost': 3, 'benefit-0': 1 },
    )
    const result = buildCareer(SEED, WEAK, input, { careers: [sampleCareer(), { ...sampleCareer(), id: 'other', name: 'Other' }], rules: CRISIS_RULES })
    expect(result.characteristicChanges['STR']).toBe(0)
    expect(result.costs).toBe(30000)
    expect(result.cash).toBe((result.benefits[0]?.cash ?? 0) - 30000)
    const other = buildCareer(
      SEED,
      WEAK,
      { ...input, choices: { ...input.choices, 'career-2.start.career': 'other' } },
      { careers: [sampleCareer(), { ...sampleCareer(), id: 'other', name: 'Other' }], rules: CRISIS_RULES },
    )
    const qualification = other.runs[1]?.qualification
    expect(qualification?.dice).toBeUndefined()
    expect(qualification?.result).toBe('fail')
    expect(qualification?.reasons).toContain('Qualification fails after an ageing crisis.')
  })

  // Lets the character die and expects a dead, finished character with nothing pending and no next career.
  it('a character who dies is finished', () => {
    const result = build(term1({ 'term-1.aging.crisis': 'die' }), CRISIS_RULES, WEAK)
    expect(result.dead).toBe(true)
    expect(result.finished).toBe(true)
    expect(result.pending).toBeUndefined()
    expect(result.nextCareer).toBeUndefined()
  })

  // Asks the policy about the crisis choice and expects no answer: the player decides.
  it('Finish career leaves the crisis to the player', () => {
    const result = build(term1(), CRISIS_RULES, WEAK)
    if (!result.pending) throw new Error('nothing pending')
    expect(policyChoice(result.pending, result, 5, SEED)).toBeUndefined()
  })
})

/** Sample rules with anagathics on SOC 10+ at 1D × Cr200000, aging from term 1 with no effects. */
const DRUG_RULES: Rules = agingRules([], { anagathics: { characteristic: 'SOC', target: 10, costDice: 1, costPerDie: 200000, prisonOnNatural: 2 } })

// Tests for anagathics.
describe('anagathics', () => {
  // Takes anagathics in term 1 with the SOC roll at 12 and the cost dice at 2, and expects the term on
  // anagathics, a Cr400000 cost, a second survival roll, and DM +1 on the aging roll.
  it('a term on anagathics costs cash, needs a second survival roll and helps the aging roll', () => {
    const result = build(term1({ 'term-1.anagathics': 'take' }, { 'term-1.anagathics': 12, 'term-1.anagathics-cost': 2, 'term-1.survival-2': 12 }), DRUG_RULES)
    expect(result.terms[0]?.anagathics).toBe(true)
    expect(result.costs).toBe(400000)
    expect(step(result, 1, 'term-1.survival-2').reasons).toContain('Anagathics: a second survival roll this term.')
    const aging = step(result, 1, 'term-1.aging')
    expect(aging.dm).toBe(sampleRules.aging.dmPerTerm + 1)
    expect(aging.reasons).toContain('DM +1 from 1 term on anagathics.')
  })

  // Takes anagathics with a failing second survival roll and expects a mishap that ends the career.
  it('failing the second survival roll gives a mishap', () => {
    const result = build(term1({ 'term-1.anagathics': 'take' }, { 'term-1.anagathics': 12, 'term-1.survival-2': 2 }), DRUG_RULES)
    expect(result.terms[0]?.steps.some((s) => s.key === 'term-1.mishap')).toBe(true)
    expect(result.terms[0]?.endReason).toBeDefined()
  })

  // Fails the SOC roll (dice 2) and expects no anagathics this term, no cost, and the prison note.
  it('a failed SOC roll means no anagathics this term', () => {
    const result = build(term1({ 'term-1.anagathics': 'take' }, { 'term-1.anagathics': 2 }), DRUG_RULES)
    expect(result.terms[0]?.anagathics).toBe(false)
    expect(result.costs).toBe(0)
    expect(step(result, 1, 'term-1.anagathics').notes.join(' ')).toContain('prison')
  })

  // Takes anagathics in term 1 but not in term 2, and expects an immediate aging roll at the start of term 2.
  it('stopping anagathics rolls aging at once', () => {
    const input = term1(
      { 'term-1.anagathics': 'take', 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' },
      { 'term-1.anagathics': 12, 'term-1.survival-2': 12 },
    )
    const result = build(input, DRUG_RULES)
    const stop = step(result, 2, 'term-2.anagathics-stop')
    expect(stop.reasons).toContain('Stopping anagathics: aging is rolled at once.')
    expect(stop.dm).toBe(sampleRules.aging.dmPerTerm * 1)
  })

  // Parses DRUG_RULES and CRISIS_RULES and expects both to pass the rules schema.
  it('the anagathics and crisis fields pass the rules schema', () => {
    expect(RulesSchema.safeParse(DRUG_RULES).success).toBe(true)
    expect(RulesSchema.safeParse(CRISIS_RULES).success).toBe(true)
  })
})
