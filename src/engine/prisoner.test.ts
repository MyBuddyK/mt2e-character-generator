import { describe, expect, it } from 'vitest'
import { parseCareerPack } from './career-pack'
import type { CareerDefinition } from './career-schema'
import type { Effect } from './effects'
import { finishCareer } from './policy'
import type { Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, type CareerData, type CareerResult, type Step } from './terms'
import { sampleRules } from '../data/rules'
import prisonerPack from '../../e2e/fixtures/prisoner-pack.json'

// Unit tests for forced-entry careers and the Parole Threshold (docs/features/prisoner-psion.md), with the
// invented e2e/fixtures/prisoner-pack.json: the Sending career's roll 8 event sends the character to the
// Holding career, which has a Parole Threshold of 1D+2 (at most 12), no anagathics and an assignment each term.

const SEED = 'prisoner'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }

/** Returns the pack's two careers, or throws when the pack does not pass. */
function packCareers(): { sending: CareerDefinition; holding: CareerDefinition } {
  const parsed = parseCareerPack(prisonerPack)
  if (!parsed.ok) throw new Error(parsed.reason)
  const sending = parsed.careers.find((c) => c.id === 'test-sending')
  const holding = parsed.careers.find((c) => c.id === 'test-holding')
  if (!sending || !holding) throw new Error('the pack is missing a career')
  return { sending, holding }
}

/** The pack's careers with `holding` in place of the Holding career when given, and `rules`. */
function data(holding?: CareerDefinition, rules: Rules = sampleRules): CareerData {
  const careers = packCareers()
  return { careers: [careers.sending, holding ?? careers.holding], rules }
}

/** Returns the Holding career with the roll 7 event's effects replaced by `effects`. */
function holdingWithEvent7(effects: Effect[]): CareerDefinition {
  const { holding } = packCareers()
  return { ...holding, events: holding.events.map((e) => (e.roll === 7 ? { ...e, summary: 'Event seven.', effects } : e)) }
}

/** Choices that play the Sending career's term 1 to its roll 8 event, muster out, and enter the Cellblock. */
const SENT = {
  'start.career': 'test-sending',
  'start.assignment': 'debris-sweep',
  'term-1.skill-0.table': 'serviceSkills',
  'term-1.next': 'muster',
  'benefit-0': 'benefit',
  'career-2.assignment': 'cellblock',
  'career-2.term-1.training.pick': 'Athletics',
  'career-2.term-1.skill-0.table': 'serviceSkills',
}
/** Rolls for SENT: the roll 8 event, a Parole Threshold of 4 (dice 2), and a term 1 that survives with event 7. */
const SENT_ROLLS = {
  qualification: 12,
  'term-1.survival': 12,
  'term-1.event': 8,
  'term-1.advancement': 2,
  'career-2.term-1.parole': 2,
  'career-2.term-1.survival': 12,
  'career-2.term-1.event': 7,
}

/** Builds with `choices`, `rolls` and `d`. */
function build(choices: Record<string, string>, rolls: Record<string, number>, d: CareerData = data()): CareerResult {
  return buildCareer(SEED, BASE, { ...EMPTY_INPUT, choices, rolls }, d)
}

/** Returns the step with key `key` in any term, or throws when it is missing. */
function step(result: CareerResult, key: string): Step {
  const found = result.terms.flatMap((t) => t.steps).find((s) => s.key === key)
  if (!found) throw new Error(`no step ${key}`)
  return found
}

// Tests for entering a forced-entry career.
describe('forced-entry careers', () => {
  // Saves the Holding career as the first career pick, and expects one problem and the career pick asked
  // again, with no career started.
  // Criteria: PP-1.
  it('a saved pick of a forced career is a problem', () => {
    const result = build({ 'start.career': 'test-holding', 'start.assignment': 'cellblock' }, {})
    expect(result.problems).toEqual(['Holding career can be entered only when an event sends the character there.'])
    expect(result.pending).toMatchObject({ kind: 'start', prefix: '' })
    expect(result.runs).toEqual([])
  })

  // Plays the Sending career's roll 8 event, and expects the Holding career started with a qualification
  // that is not rolled.
  // Criteria: PP-2.
  it('a next-career event starts the forced career with no qualification roll', () => {
    const result = build(SENT, SENT_ROLLS)
    expect(result.runs[1]?.career.id).toBe('test-holding')
    expect(result.runs[1]?.forced).toBe(true)
    expect(result.runs[1]?.qualification.dice).toBeUndefined()
  })
})

// Tests for the Parole Threshold roll and the parole effects.
describe('Parole Threshold', () => {
  // Enters the Holding career with parole dice of 2, and expects a Parole Threshold step of 4 after basic
  // training and rank 0; with a max of 5 and dice of 6, expects 5 and the cap as a reason.
  // Criteria: PP-3.
  it('term 1 rolls the Parole Threshold after basic training', () => {
    const result = build(SENT, SENT_ROLLS)
    const keys = result.terms[1]?.steps.map((s) => s.key) ?? []
    expect(keys.indexOf('career-2.term-1.parole')).toBe(keys.indexOf('career-2.term-1.rank-0') + 1)
    expect(keys.indexOf('career-2.term-1.training')).toBeLessThan(keys.indexOf('career-2.term-1.parole'))
    const parole = step(result, 'career-2.term-1.parole')
    expect(parole.label).toBe('Parole Threshold')
    expect(parole.result).toBe('4')
    expect(result.runs[1]?.parole).toBe(4)
    const { holding } = packCareers()
    const capped = build(SENT, { ...SENT_ROLLS, 'career-2.term-1.parole': 6 }, data({ ...holding, parole: { dice: 1, plus: 2, max: 5 } }))
    expect(step(capped, 'career-2.term-1.parole').result).toBe('5')
    expect(step(capped, 'career-2.term-1.parole').reasons).toEqual(['The Parole Threshold is capped at 5.'])
  })

  // With a threshold of 8 (dice 6), sets event 7 to parole +3 and expects 11, then to parole +9 and expects
  // 12 (the cap). With a threshold of 4, sets it to parole-reroll (dice 5) and expects 7 on a step labelled
  // "Parole Threshold (rolled again)", then to parole-lower-dice 1 (dice 3) and expects 1 on a step labelled
  // "Parole Threshold (lowered)".
  // Criteria: PP-4.
  it('the parole effects change the threshold', () => {
    const raise = build(SENT, { ...SENT_ROLLS, 'career-2.term-1.parole': 6 }, data(holdingWithEvent7([{ type: 'parole', change: 3 }])))
    expect(step(raise, 'career-2.term-1.event').applied).toEqual(['Parole Threshold +3 (now 11)'])
    const cap = build(SENT, { ...SENT_ROLLS, 'career-2.term-1.parole': 6 }, data(holdingWithEvent7([{ type: 'parole', change: 9 }])))
    expect(cap.runs[1]?.parole).toBe(12)
    const reroll = build(
      SENT,
      { ...SENT_ROLLS, 'career-2.term-1.event.effect-0.parole': 5 },
      data(holdingWithEvent7([{ type: 'parole-reroll' }])),
    )
    expect(step(reroll, 'career-2.term-1.event.effect-0.parole').result).toBe('7')
    expect(step(reroll, 'career-2.term-1.event.effect-0.parole').label).toBe('Parole Threshold (rolled again)')
    expect(reroll.runs[1]?.parole).toBe(7)
    const lower = build(
      SENT,
      { ...SENT_ROLLS, 'career-2.term-1.event.effect-0.parole': 3 },
      data(holdingWithEvent7([{ type: 'parole-lower-dice', dice: 1 }])),
    )
    expect(step(lower, 'career-2.term-1.event').applied).toEqual(['Parole Threshold -1D (now 1)'])
    expect(step(lower, 'career-2.term-1.event.effect-0.parole').label).toBe('Parole Threshold (lowered)')
    expect(lower.runs[1]?.parole).toBe(1)
  })

  // Gives the Sending career's roll 8 event a parole effect in place of next-career, and expects a note and
  // no Parole Threshold.
  // Criteria: PP-5.
  it('a parole effect outside a career with parole is a note', () => {
    const { sending, holding } = packCareers()
    const plain = { ...sending, events: sending.events.map((e) => (e.roll === 8 ? { ...e, effects: [{ type: 'parole' as const, change: 1 }] } : e)) }
    const result = build(SENT, SENT_ROLLS, { careers: [plain, holding], rules: sampleRules })
    const event = step(result, 'term-1.event')
    expect(event.notes).toEqual(['Change the Parole Threshold by hand: the character has no Parole Threshold in this career.'])
    expect(event.applied).toEqual([])
    expect(result.runs[0]?.parole).toBeUndefined()
  })
})

// Tests for how a career with parole ends.
describe('leaving a career with parole', () => {
  // With a threshold of 4, rolls advancement dice of 12 and expects a forced muster out; rolls 4 (a total of
  // 4) and expects a forced continue in term 1, where the usual rules would not force it.
  // Criteria: PP-6.
  it('the advancement total against the Parole Threshold ends or continues the career', () => {
    const out = build({ ...SENT, 'career-2.term-1.advancement-skill-0.table': 'serviceSkills' }, { ...SENT_ROLLS, 'career-2.term-1.advancement': 12 })
    expect(out.pending).toMatchObject({ kind: 'next', key: 'career-2.term-1.next', forced: 'muster' })
    expect(out.pending?.kind === 'next' ? out.pending.reason : '').toBe('Advancement 12 is above the Parole Threshold 4, so the sentence ends after this term.')
    const stay = build(SENT, { ...SENT_ROLLS, 'career-2.term-1.advancement': 4 })
    expect(stay.pending).toMatchObject({ kind: 'next', forced: 'continue' })
    expect(stay.pending?.kind === 'next' ? stay.pending.reason : '').toBe('Advancement 4 is not above the Parole Threshold 4, so the character must continue.')
    expect(step(stay, 'career-2.term-1.advancement').reasons).toContain('Advancement 4 is not above the Parole Threshold 4, so the character must continue.')
  })

  // Fails survival in the Holding career with mishap roll 6, and expects a mishap that keeps the job, no
  // event and no advancement step, a forced continue, and no lost benefit roll.
  // Criteria: PP-7.
  it('a failed survival keeps the character in the career', () => {
    const result = build(SENT, { ...SENT_ROLLS, 'career-2.term-1.survival': 2, 'career-2.term-1.mishap': 6 })
    const keys = result.terms[1]?.steps.map((s) => s.key) ?? []
    expect(step(result, 'career-2.term-1.mishap').label).toBe('Mishap (keeps the job)')
    expect(keys).not.toContain('career-2.term-1.event')
    expect(keys).not.toContain('career-2.term-1.advancement')
    expect(result.pending).toMatchObject({ kind: 'next', forced: 'continue' })
    expect(result.pending?.kind === 'next' ? result.pending.reason : '').toBe(
      'Survival failed, so there is no advancement roll this term and the character must continue.',
    )
    expect(result.runs[1]?.lostBenefitTerms).toBe(0)
  })

  // Sets event 7 to leave-career and rolls advancement 2, and expects a forced muster out.
  // Criteria: PP-8.
  it('a leave-career effect ends a career with parole', () => {
    const result = build(SENT, { ...SENT_ROLLS, 'career-2.term-1.advancement': 2 }, data(holdingWithEvent7([{ type: 'leave-career' }])))
    expect(result.pending).toMatchObject({ kind: 'next', forced: 'muster', reason: 'An event ends the career after this term.' })
  })

  // Sets event 7 to promote, and expects an automatic advancement and a separate parole check: dice of 12
  // force muster out with the reason on the parole check, and dice of 2 force continue.
  // Criteria: PP-12.
  it('an automatic promotion still rolls against the Parole Threshold', () => {
    const d = data(holdingWithEvent7([{ type: 'promote' }]))
    const choices = { ...SENT, 'career-2.term-1.advancement-skill-0.table': 'serviceSkills' }
    const out = build(choices, { ...SENT_ROLLS, 'career-2.term-1.parole-check': 12 }, d)
    expect(step(out, 'career-2.term-1.advancement').dice).toBeUndefined()
    expect(step(out, 'career-2.term-1.advancement').reasons).toEqual(['Automatic promotion from an event this term.'])
    const check = step(out, 'career-2.term-1.parole-check')
    expect(check.label).toBe('Advancement (parole)')
    expect(check.reasons).toContain('Advancement 12 is above the Parole Threshold 4, so the sentence ends after this term.')
    expect(out.pending).toMatchObject({ kind: 'next', forced: 'muster' })
    const stay = build(choices, { ...SENT_ROLLS, 'career-2.term-1.parole-check': 2 }, d)
    expect(stay.pending).toMatchObject({ kind: 'next', forced: 'continue' })
  })
})

// Tests for anagathics and the assignment in the Holding career.
describe('Holding career rules', () => {
  /** The sample rules with anagathics on an invented END 7+ check. */
  const drugs: Rules = { ...sampleRules, anagathics: { characteristic: 'END', target: 7, costDice: 1, costPerDie: 1000 } }

  // With anagathics in the rules, takes them in the Sending career's term 1, and expects no anagathics
  // choice in the Holding career and the stopping aging roll in its term 1.
  // Criteria: PP-9.
  it('a career with anagathics: false offers none', () => {
    const choices = { ...SENT, 'term-1.anagathics': 'take' }
    const rolls = { ...SENT_ROLLS, 'term-1.anagathics': 12, 'term-1.survival-2': 12 }
    const result = build(choices, rolls, data(undefined, drugs))
    expect(result.terms[0]?.anagathics).toBe(true)
    const keys = result.terms[1]?.steps.map((s) => s.key) ?? []
    expect(keys).toContain('career-2.term-1.anagathics-stop')
    expect(keys).not.toContain('career-2.term-1.anagathics')
    expect(result.usedKeys).not.toContain('career-2.term-1.anagathics')
  })

  // Reaches term 2 of the Holding career, and expects an assignment choice that keeps the Cellblock for
  // Finish career; picking the Workshop keeps rank 0 with its title "Hand" and adds an Assignment step.
  // Criteria: PP-10.
  it('the assignment is asked at the start of each later term', () => {
    const choices = { ...SENT, 'career-2.term-1.next': 'continue' }
    const rolls = { ...SENT_ROLLS, 'career-2.term-1.advancement': 3 }
    const asks = build(choices, rolls)
    expect(asks.pending).toMatchObject({ kind: 'assignment', key: 'career-2.term-2.assignment', keep: 'cellblock' })
    const finished = finishCareer(SEED, BASE, { ...EMPTY_INPUT, choices, rolls }, data())
    expect(finished.choices['career-2.term-2.assignment']).toBe('cellblock')
    const moved = build({ ...choices, 'career-2.term-2.assignment': 'workshop', 'career-2.term-2.skill-0.table': 'serviceSkills' }, rolls)
    expect(step(moved, 'career-2.term-2.assignment').result).toBe('Workshop')
    expect(moved.runs[1]?.assignment?.id).toBe('workshop')
    expect(moved.terms[2]?.rank).toBe(0)
    expect(moved.terms[2]?.title).toBe('Hand')
  })

  // Runs Finish career from the start of the Holding career, and expects it to keep continuing until a term
  // whose advancement total is above the Parole Threshold, and then muster out.
  // Criteria: PP-11.
  it('Finish career continues until the sentence ends', () => {
    const input = { ...EMPTY_INPUT, choices: SENT, rolls: { ...SENT_ROLLS, 'career-2.term-1.advancement': 3, 'career-2.term-3.advancement': 12 } }
    const finished = finishCareer(SEED, BASE, input, data())
    const result = buildCareer(SEED, BASE, finished, data())
    expect(finished.choices['career-2.term-1.next']).toBe('continue')
    const holdingTerms = result.runs[1]?.terms ?? []
    const last = holdingTerms[holdingTerms.length - 1]
    expect(last?.endReason).toMatch(/is above the Parole Threshold \d+, so the sentence ends after this term\.$/)
    expect(holdingTerms.slice(0, -1).every((t) => t.stayReason !== undefined)).toBe(true)
    expect(holdingTerms.length).toBeLessThanOrEqual(3)
    expect(result.runs[1]?.benefitCount).toBeGreaterThan(0)
  })
})
