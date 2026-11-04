import { describe, expect, it } from 'vitest'
import { parseCareerPack } from './career-pack'
import type { CareerDefinition } from './career-schema'
import type { Effect } from './effects'
import { finishCareer } from './policy'
import type { Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, type CareerData, type CareerResult, type Step } from './terms'
import { sampleRules } from '../data/rules'
import psionPack from '../../e2e/fixtures/psion-pack.json'

// Unit tests for PSI and talents (docs/features/prisoner-psion.md), with the invented
// e2e/fixtures/psion-pack.json: the Testing career's roll 8 event is a PSI test, and the Mind career opens
// once PSI is tested, qualifies on PSI 6+, and rolls three talents (Mindspeech +3, automatic when picked
// first; Farsight +2; Lifting +1) against 8 with -2 for each earlier talent roll.

const SEED = 'psion'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }

/** Returns the pack's two careers, or throws when the pack does not pass. */
function packCareers(): { testing: CareerDefinition; mind: CareerDefinition } {
  const parsed = parseCareerPack(psionPack)
  if (!parsed.ok) throw new Error(parsed.reason)
  const testing = parsed.careers.find((c) => c.id === 'test-testing')
  const mind = parsed.careers.find((c) => c.id === 'test-mind')
  if (!testing || !mind) throw new Error('the pack is missing a career')
  return { testing, mind }
}

/** The pack's careers, with `testing` in place of the Testing career when given, and `rules`. */
function data(testing?: CareerDefinition, rules: Rules = sampleRules): CareerData {
  const careers = packCareers()
  return { careers: [testing ?? careers.testing, careers.mind], rules }
}

/** Returns the Testing career with the roll 8 event's effects replaced by `effects`. */
function testingWithEvent8(effects: Effect[]): CareerDefinition {
  const { testing } = packCareers()
  return { ...testing, events: testing.events.map((e) => (e.roll === 8 ? { ...e, summary: 'Event eight.', effects } : e)) }
}

/** Choices that play one term of the Testing career, leave, and start the Mind career's Untrained assignment. */
const TESTED = {
  'start.career': 'test-testing',
  'start.assignment': 'debris-sweep',
  'term-1.skill-0.table': 'serviceSkills',
  'term-1.next': 'leave',
  'benefit-0': 'benefit',
  'career-2.start.career': 'test-mind',
  'career-2.start.assignment': 'untrained',
}
/** Rolls for TESTED: the roll 8 event with PSI dice of 9 (PSI 9), and a Mind career qualification of 12. */
const TESTED_ROLLS = {
  qualification: 12,
  'term-1.survival': 12,
  'term-1.event': 8,
  'term-1.event.effect-0.psi': 9,
  'term-1.advancement': 2,
  'career-2.qualification': 12,
}
/** Talent picks: Mindspeech first (automatic), then Lifting; Farsight, the last one left, needs no pick. */
const TALENTS = {
  'career-2.term-1.talents.pick-0': 'Mindspeech',
  'career-2.term-1.talents.pick-1': 'Lifting',
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

// Tests for the PSI test and the careers it opens.
describe('PSI test', () => {
  // Rolls the PSI test in term 1 with dice of 9 and expects PSI 9; in term 2 with dice of 9 and expects 8
  // with the DM for one term; with a PSI test in both terms, expects the second to be a note.
  // Criteria: PP-14.
  it('psi-test rolls 2D minus the terms served, once', () => {
    const first = build(TESTED, TESTED_ROLLS)
    expect(step(first, 'term-1.event.effect-0.psi').label).toBe('PSI test')
    expect(first.psi).toBe(9)
    const choices = { ...TESTED, 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' }
    const rolls = { ...TESTED_ROLLS, 'term-1.event': 5, 'term-2.survival': 12, 'term-2.event': 8, 'term-2.event.effect-0.psi': 9 }
    const later = build(choices, rolls)
    expect(later.psi).toBe(8)
    expect(step(later, 'term-2.event.effect-0.psi').reasons).toEqual(['DM -1 for 1 term served.'])
    const twice = build(choices, { ...rolls, 'term-1.event': 8 })
    expect(twice.psi).toBe(9)
    expect(step(twice, 'term-2.event').notes).toEqual(["The character's PSI is already tested (PSI 9), so this changes nothing."])
  })

  // Saves the Mind career as the first career pick, and expects a problem and the career pick again; after the
  // PSI test, expects the Mind career started under career-2.
  // Criteria: PP-15.
  it('a psi-tested career can be picked only after a PSI test', () => {
    const early = build({ 'start.career': 'test-mind', 'start.assignment': 'untrained' }, {})
    expect(early.problems).toEqual(["Mind career can be picked only once the character's PSI has been tested."])
    expect(early.pending).toMatchObject({ kind: 'start', prefix: '' })
    const later = build(TESTED, TESTED_ROLLS)
    expect(later.runs[1]?.career.id).toBe('test-mind')
  })

  // With PSI 9 (DM +1) and rules with DM -1 per earlier career, rolls the Mind career's qualification and
  // expects PSI as the characteristic, a DM of 0, and the earlier-career reason.
  // Criteria: PP-16.
  it('a PSI qualification uses the PSI DM and the DM for earlier careers', () => {
    const rules: Rules = { ...sampleRules, qualification: { dmPerPreviousCareer: -1 } }
    const result = build(TESTED, { ...TESTED_ROLLS, 'career-2.qualification': 7 }, data(undefined, rules))
    const qualification = result.runs[1]?.qualification
    expect(qualification?.characteristic).toBe('PSI')
    expect(qualification?.dm).toBe(0)
    expect(qualification?.reasons).toContain('DM -1 for 1 earlier career.')
  })
})

// Tests for PSI changes.
describe('PSI changes', () => {
  // Gives the Testing career's roll 8 event a PSI +1 effect and expects a note and no PSI; then, in the Mind
  // career, rolls personal development 6 ("PSI +1") and expects PSI 10.
  // Criteria: PP-17.
  it('a PSI change applies after a test and is a note before one', () => {
    const before = build(TESTED, TESTED_ROLLS, data(testingWithEvent8([{ type: 'characteristic', characteristic: 'PSI', change: 1 }])))
    expect(step(before, 'term-1.event').notes).toEqual(["PSI +1 changes nothing: the character's PSI hasn't been tested."])
    expect(before.psi).toBeUndefined()
    const choices = { ...TESTED, ...TALENTS, 'career-2.term-1.training.pick': 'Deception', 'career-2.term-1.skill-0.table': 'personalDevelopment' }
    const after = build(choices, { ...TESTED_ROLLS, 'career-2.term-1.skill-0': 6 })
    expect(step(after, 'career-2.term-1.skill-0').applied).toEqual(['PSI +1'])
    expect(after.psi).toBe(10)
  })
})

// Tests for talent rolls.
describe('talents', () => {
  // Starts the Mind career with PSI 9 and expects a talent pick of all three; picks Mindspeech (automatic),
  // Lifting (DM +1 +1) and Farsight (DM +1 +2 -2); then picks Farsight first and expects a roll with DM +3,
  // and Mindspeech rolled later with DM +1 +3 -2.
  // Criteria: PP-18.
  it('term 1 rolls each talent in the picked order', () => {
    const asks = build(TESTED, TESTED_ROLLS)
    expect(asks.pending).toEqual({ kind: 'talent', key: 'career-2.term-1.talents.pick-0', options: ['Mindspeech', 'Farsight', 'Lifting'] })
    const rolls = { ...TESTED_ROLLS, 'career-2.term-1.talents.roll-1': 12, 'career-2.term-1.talents.roll-2': 12 }
    const result = build({ ...TESTED, ...TALENTS }, rolls)
    expect(step(result, 'career-2.term-1.talents.roll-0').label).toBe('Talent: Mindspeech (automatic)')
    expect(step(result, 'career-2.term-1.talents.roll-0').dice).toBeUndefined()
    expect(step(result, 'career-2.term-1.talents.roll-1').dm).toBe(2)
    expect(step(result, 'career-2.term-1.talents.roll-2').dm).toBe(1)
    expect(step(result, 'career-2.term-1.talents.roll-2').reasons).toEqual(['DM +2 for Farsight.', 'DM -2 for 1 earlier talent roll.'])
    expect(result.skills['Mindspeech']).toBe(0)
    expect(result.skills['Lifting']).toBe(0)
    expect(result.skills['Farsight']).toBe(0)
    const keys = result.terms[1]?.steps.map((s) => s.key) ?? []
    expect(keys.indexOf('career-2.term-1.talents.roll-2')).toBeLessThan(keys.indexOf('career-2.term-1.training'))
    const reordered = build(
      { ...TESTED, 'career-2.term-1.talents.pick-0': 'Farsight', 'career-2.term-1.talents.pick-1': 'Mindspeech' },
      TESTED_ROLLS,
    )
    expect(step(reordered, 'career-2.term-1.talents.roll-0').dm).toBe(3)
    expect(step(reordered, 'career-2.term-1.talents.roll-1').label).toBe('Talent: Mindspeech')
    expect(step(reordered, 'career-2.term-1.talents.roll-1').dm).toBe(2)
  })

  // Fails the Lifting talent roll, then rolls service skills 3 ("Lifting"), and expects a talent roll for
  // Lifting first: dice of 2 give nothing and a reason, dice of 12 give Lifting 1.
  // Criteria: PP-19.
  it('a skill gain naming a missing talent rolls for it first', () => {
    const choices = { ...TESTED, ...TALENTS, 'career-2.term-1.training.pick': 'Deception', 'career-2.term-1.skill-0.table': 'serviceSkills' }
    const rolls = { ...TESTED_ROLLS, 'career-2.term-1.talents.roll-1': 2, 'career-2.term-1.talents.roll-2': 12, 'career-2.term-1.skill-0': 3 }
    const failed = build(choices, { ...rolls, 'career-2.term-1.skill-0.talent-0': 2 })
    expect(step(failed, 'career-2.term-1.skill-0.talent-0').label).toBe('Talent: Lifting')
    expect(step(failed, 'career-2.term-1.skill-0').reasons).toEqual(['No Lifting: its talent roll failed.'])
    expect(failed.skills['Lifting']).toBeUndefined()
    const passedRoll = build(choices, { ...rolls, 'career-2.term-1.skill-0.talent-0': 12 })
    expect(passedRoll.skills['Lifting']).toBe(1)
  })

  // Runs Finish career from the start of the Mind career, and expects Mindspeech and Farsight picked in the
  // listed order, and Lifting, the last one left, rolled third with no pick.
  // Criteria: PP-20.
  it('Finish career tries the talents in the listed order', () => {
    const finished = finishCareer(SEED, BASE, { ...EMPTY_INPUT, choices: TESTED, rolls: TESTED_ROLLS }, data())
    expect(finished.choices['career-2.term-1.talents.pick-0']).toBe('Mindspeech')
    expect(finished.choices['career-2.term-1.talents.pick-1']).toBe('Farsight')
    expect(finished.choices['career-2.term-1.talents.pick-2']).toBeUndefined()
    expect(step(buildCareer(SEED, BASE, finished, data()), 'career-2.term-1.talents.roll-2').label).toBe('Talent: Lifting')
  })
})

// Tests for talent rolls on later steps, careers and basic training.
describe('talent rolls after term 1 starts', () => {
  /** Choices and rolls that fail the Lifting and Farsight talent rolls in the Mind career's term 1. */
  const FAILED = {
    choices: { ...TESTED, ...TALENTS, 'career-2.term-1.training.pick': 'Deception', 'career-2.term-1.skill-0.table': 'personalDevelopment' },
    rolls: { ...TESTED_ROLLS, 'career-2.term-1.talents.roll-1': 2, 'career-2.term-1.talents.roll-2': 2, 'career-2.term-1.skill-0': 1, 'career-2.term-1.survival': 12 },
  }

  // Replaces the Mind career's roll 9 event with gains of Lifting and Farsight, fails both talent rolls in
  // term 1, rolls event 9, and expects two talent rolls on the event step with keys talent-0 and talent-1.
  // Criteria: PP-22.
  it('two talent rolls on one step have their own keys', () => {
    const { testing, mind } = packCareers()
    const twoGains: CareerDefinition = {
      ...mind,
      events: mind.events.map((e) =>
        e.roll === 9
          ? { ...e, effects: [{ type: 'skill', options: ['Lifting'] }, { type: 'skill', options: ['Farsight'] }] }
          : e,
      ),
    }
    const rolls = { ...FAILED.rolls, 'career-2.term-1.event': 9, 'career-2.term-1.event.talent-0': 12, 'career-2.term-1.event.talent-1': 2 }
    const result = build(FAILED.choices, rolls, { careers: [testing, twoGains], rules: sampleRules })
    expect(step(result, 'career-2.term-1.event.talent-0').label).toBe('Talent: Lifting')
    expect(step(result, 'career-2.term-1.event.talent-1').label).toBe('Talent: Farsight')
    expect(result.skills['Lifting']).toBe(1)
    expect(result.skills['Farsight']).toBeUndefined()
  })

  // Fails Lifting and Farsight in the Mind career, leaves, plays the Testing career, starts the Mind career
  // again, and expects no talent pick and no talent roll in its term 1.
  // Criteria: PP-23.
  it('joining the career again rolls no talent rolled for before', () => {
    const choices = {
      ...FAILED.choices,
      'career-2.term-1.next': 'leave',
      'career-2.benefit-0': 'benefit',
      'career-3.start.career': 'test-testing',
      'career-3.start.assignment': 'debris-sweep',
      'career-3.term-1.training.pick': 'Pilot',
      'career-3.term-1.skill-0.table': 'serviceSkills',
      'career-3.term-1.next': 'leave',
      'career-3.benefit-0': 'benefit',
      'career-4.start.career': 'test-mind',
      'career-4.start.assignment': 'untrained',
    }
    const rolls = {
      ...FAILED.rolls,
      'career-2.term-1.event': 8,
      'career-2.term-1.advancement': 2,
      'career-3.qualification': 12,
      'career-3.term-1.survival': 12,
      'career-3.term-1.event': 5,
      'career-3.term-1.advancement': 2,
      'career-4.qualification': 12,
    }
    const result = build(choices, rolls)
    expect(result.runs[3]?.career.id).toBe('test-mind')
    expect(result.pending?.kind).not.toBe('talent')
    const keys = result.terms.flatMap((t) => t.steps).map((s) => s.key)
    expect(keys.filter((k) => k.startsWith('career-4.term-1.talents'))).toEqual([])
  })

  // Fails the Lifting talent roll, picks Lifting in basic training, and expects a reason, no Lifting and no
  // talent roll on the training step.
  // Criteria: PP-24.
  it('basic training gives no talent the character lacks', () => {
    const choices = { ...FAILED.choices, 'career-2.term-1.training.pick': 'Lifting' }
    const result = build(choices, FAILED.rolls)
    expect(step(result, 'career-2.term-1.training').reasons).toContain('No Lifting: in basic training a talent comes only from its talent roll.')
    expect(result.skills['Lifting']).toBeUndefined()
    expect(result.terms.flatMap((t) => t.steps).some((s) => s.key.startsWith('career-2.term-1.training.talent'))).toBe(false)
  })
})
