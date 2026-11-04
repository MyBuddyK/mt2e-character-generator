import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { EffectSchema, type Effect } from './effects'
import { finishCareer } from './policy'
import type { Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, removeLastTerm, type CareerInput, type CareerResult, type Step } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'

// Unit tests for the check, fail-graduation and next-career effects (docs/features/education.md). Each test
// builds the invented sample career with its roll 7 event replaced, and term 1 forced to that event.

const SEED = 'education-effects'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
/** Qualification and term 1 survival pass, the event is roll 7, and term 1 advancement rolls 2 (a fail). */
const ROLLS = { qualification: 12, 'term-1.survival': 12, 'term-1.event': 7, 'term-1.advancement': 2 }
/** Starts the debris-sweep assignment and picks Service skills for the term 1 skill roll. */
const START = {
  'start.career': 'sample-sanitation',
  'start.assignment': 'debris-sweep',
  'term-1.skill-0.table': 'serviceSkills',
}
/** The key of the term 1 event's first effect. */
const EFFECT = 'term-1.event.effect-0'

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

/** Returns the sample career with the roll 7 event's effects replaced by `effects`. */
function withEvent7(effects: Effect[]): CareerDefinition {
  const career = sampleCareer()
  return { ...career, events: career.events.map((e) => (e.roll === 7 ? { ...e, summary: 'Event seven.', effects } : e)) }
}

/** An invented second career with one assignment, used as a `next-career` target. */
function recycling(): CareerDefinition {
  const career = sampleCareer()
  const first = career.assignments[0]
  if (!first) throw new Error('the sample career has no assignment')
  return { ...career, id: 'sample-recycling', name: 'Sample Recycling', assignments: [first] }
}

/** The sample rules with a one-row Draft table into the sample career's hazmat assignment. */
const DRAFT_RULES: Rules = { ...sampleRules, draft: [{ roll: 1, career: 'sample-sanitation', assignment: 'hazmat' }] }

/** Returns START plus `choices` and ROLLS plus `rolls` as a CareerInput. */
function input(choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerInput {
  return { ...EMPTY_INPUT, choices: { ...START, ...choices }, rolls: { ...ROLLS, ...rolls } }
}

/** Builds with `careers` (the first one is entered) and `rules`, and the given extra choices and rolls. */
function build(
  careers: CareerDefinition[],
  choices: Record<string, string> = {},
  rolls: Record<string, number> = {},
  rules: Rules = sampleRules,
): CareerResult {
  return buildCareer(SEED, BASE, input(choices, rolls), { careers, rules })
}

/** Returns the step with key `key` in any term, or throws when it is missing. */
function step(result: CareerResult, key: string): Step {
  const found = result.terms.flatMap((t) => t.steps).find((s) => s.key === key)
  if (!found) throw new Error(`no step ${key}`)
  return found
}

/** Choices that muster out of term 1 and take a benefit roll. */
const MUSTER = { 'term-1.next': 'muster', 'benefit-0': 'benefit' }

// Tests for the check effect.
describe('check effect', () => {
  // Uses an INT 8+ check with Admin on a pass and Science on a fail, rolls 8 then 2, and expects the Check
  // step right after the event, DM 0 for INT 7, and Admin then Science.
  // Criteria: ED-16.
  it('a characteristic check applies pass or fail effects', () => {
    const career = withEvent7([
      { type: 'check', options: ['INT'], target: 8, pass: [{ type: 'skill', options: ['Admin'] }], fail: [{ type: 'skill', options: ['Science'] }] },
    ])
    const pass = build([career], {}, { [`${EFFECT}.check`]: 8 })
    const keys = pass.terms[0]?.steps.map((s) => s.key) ?? []
    expect(keys.indexOf(`${EFFECT}.check`)).toBe(keys.indexOf('term-1.event') + 1)
    const roll = step(pass, `${EFFECT}.check`)
    expect(roll.label).toBe('Check: INT')
    expect(roll.dm).toBe(0)
    expect(roll.result).toBe('pass')
    expect(pass.skills['Admin']).toBe(1)
    expect(pass.skills['Science']).toBeUndefined()
    const fail = build([career], {}, { [`${EFFECT}.check`]: 2 })
    expect(step(fail, `${EFFECT}.check`).result).toBe('fail')
    expect(fail.skills['Science']).toBe(1)
    expect(fail.skills['Admin']).toBeUndefined()
  })

  // Uses a check with an untrained skill and a skill from basic training, expects a skill-option pending,
  // then DM -3 for the untrained skill and DM 0 for the trained one.
  // Criteria: ED-17.
  it('a skill check asks for the option and uses the skill level', () => {
    const trained = Object.keys(build([sampleCareer()]).skills)[0]
    if (!trained) throw new Error('basic training gave no skill')
    const career = withEvent7([{ type: 'check', options: ['Untrained Skill', trained], target: 8 }])
    expect(build([career]).pending).toEqual({ kind: 'skill-option', key: `${EFFECT}.check-option`, options: ['Untrained Skill', trained] })
    const untrained = build([career], { [`${EFFECT}.check-option`]: 'Untrained Skill' })
    expect(step(untrained, `${EFFECT}.check`).dm).toBe(-3)
    const known = build([career], { [`${EFFECT}.check-option`]: trained })
    expect(step(known, `${EFFECT}.check`).dm).toBe(0)
  })

  // Parses checks whose pass holds a check, whose fail holds a choice, and whose options repeat, and expects
  // each to fail EffectSchema; a check with basic pass and fail effects passes.
  // Criteria: ED-18.
  it('a check cannot nest a check or a choice', () => {
    const inner = { type: 'check', options: ['INT'], target: 8 }
    const choice = { type: 'choice', options: [{ label: 'a' }, { label: 'b' }] }
    expect(EffectSchema.safeParse({ ...inner, pass: [inner] }).success).toBe(false)
    expect(EffectSchema.safeParse({ ...inner, fail: [choice] }).success).toBe(false)
    expect(EffectSchema.safeParse({ ...inner, options: ['INT', 'INT'] }).success).toBe(false)
    expect(EffectSchema.safeParse({ ...inner, pass: [{ type: 'next-career', career: 'x' }], fail: [{ type: 'fail-graduation' }] }).success).toBe(true)
  })
})

// Tests for the fail-graduation effect outside education.
describe('fail-graduation effect', () => {
  // Uses a fail-graduation effect on the event and expects a note, nothing applied, and the same result as an
  // event with no effects apart from the note.
  // Criteria: ED-19.
  it('in a career term it is a note', () => {
    const result = build([withEvent7([{ type: 'fail-graduation' }])])
    const event = step(result, 'term-1.event')
    expect(event.notes).toEqual(['Fails graduation: this applies only in an education term, so nothing changes here.'])
    expect(event.applied).toEqual([])
    expect(result.terms[0]?.endReason).toBeUndefined()
  })
})

// Tests for the next-career effect.
describe('next-career effect', () => {
  // Sends the character to Sample Recycling, expects the after-term choice forced to muster out, then after
  // the benefit roll a second career of Sample Recycling, forced, with a qualification step that is not rolled.
  // Criteria: ED-20.
  it('a loaded career starts next with no qualification roll', () => {
    const careers = [withEvent7([{ type: 'next-career', career: 'sample-recycling' }]), recycling()]
    const first = build(careers)
    expect(step(first, 'term-1.event').applied).toEqual(['Sample Recycling next term'])
    expect(first.pending).toMatchObject({ kind: 'next', key: 'term-1.next', forced: 'muster' })
    const second = build(careers, MUSTER)
    expect(second.runs).toHaveLength(2)
    const run = second.runs[1]
    expect(run?.career.id).toBe('sample-recycling')
    expect(run?.forced).toBe(true)
    expect(run?.entry).toBe('qualified')
    expect(run?.qualification.dice).toBeUndefined()
    expect(run?.qualification.reasons).toEqual(['No qualification roll: an event sent the character to Sample Recycling.'])
    expect(second.terms[1]?.key).toBe('career-2.term-1')
  })

  // Fails qualification and takes the Draft for career 1, then sends the character to the Draft by an event,
  // and expects career 2 to roll the Draft again and be marked forced and drafted.
  // Criteria: ED-21.
  it('the Draft is rolled again even after an earlier Draft', () => {
    const careers = [withEvent7([{ type: 'next-career', career: 'draft' }])]
    const result = build(careers, { fallback: 'draft', ...MUSTER }, { qualification: 2 }, DRAFT_RULES)
    expect(result.runs[0]?.entry).toBe('draft')
    const run = result.runs[1]
    expect(run?.forced).toBe(true)
    expect(run?.entry).toBe('draft')
    expect(run?.draft?.key).toBe('career-2.draft')
    expect(run?.assignment?.id).toBe('hazmat')
  })

  // Names a career no pack has, then the Draft with rules that have no Draft table, and expects a note each
  // time, no end reason on the term, and no forced after-term choice.
  // Criteria: ED-22.
  it('an unknown career or a missing Draft table is a note', () => {
    const unknown = build([withEvent7([{ type: 'next-career', career: 'prisoner' }])])
    expect(step(unknown, 'term-1.event').notes).toContain('Take the career "prisoner" next term by hand: no loaded career pack has it.')
    expect(unknown.terms[0]?.endReason).toBeUndefined()
    const noDraft = build([withEvent7([{ type: 'next-career', career: 'draft' }])])
    expect(step(noDraft, 'term-1.event').notes).toContain('Take the Draft next term by hand: the rules have no Draft table.')
    expect(noDraft.terms[0]?.endReason).toBeUndefined()
  })

  // Runs Finish career on a career whose term 1 event sends the character to Sample Recycling, and expects
  // the second career started with no choice saved under its prefix.
  // Criteria: ED-23.
  it('Finish career stops when the forced career starts', () => {
    const data = { careers: [withEvent7([{ type: 'next-career', career: 'sample-recycling' }]), recycling()], rules: sampleRules }
    const finished = finishCareer(SEED, BASE, input(), data)
    expect(buildCareer(SEED, BASE, finished, data).runs).toHaveLength(2)
    expect(Object.keys(finished.choices).filter((k) => k.startsWith('career-2.'))).toEqual([])
  })

  // Builds into the forced career's first term, removes the last term, and expects the after-term choice of
  // career 1's term 1 to be pending again, forced to muster out.
  // Criteria: ED-24.
  it('removing the forced career’s first term returns to the term before', () => {
    const data = { careers: [withEvent7([{ type: 'next-career', career: 'sample-recycling' }]), recycling()], rules: sampleRules }
    const full = input({ ...MUSTER, 'career-2.term-1.skill-0.table': 'serviceSkills' })
    expect(buildCareer(SEED, BASE, full, data).terms).toHaveLength(2)
    const removal = removeLastTerm(SEED, BASE, full, data)
    if (!removal) throw new Error('nothing removed')
    const after = buildCareer(SEED, BASE, removal.input, data)
    expect(after.terms).toHaveLength(1)
    expect(after.pending).toMatchObject({ kind: 'next', key: 'term-1.next', forced: 'muster' })
  })

  // Uses a Draft table whose only row names a career no pack has, sends the character to the Draft, and
  // expects the problem listed and the next career pick offered; picking Sample Recycling then starts it with
  // a qualification roll.
  // Criteria: ED-25.
  it('a forced Draft into a missing career falls back to the career pick', () => {
    const rules: Rules = { ...sampleRules, draft: [{ roll: 1, career: 'missing-career' }] }
    const careers = [withEvent7([{ type: 'next-career', career: 'draft' }]), recycling()]
    const result = build(careers, MUSTER, {}, rules)
    expect(result.problems).toContain('An event sent the character to the Draft, but the Draft named a career no pack has, so pick the next career.')
    expect(result.finished).toBe(true)
    expect(result.nextCareer).toEqual({ prefix: 'career-2.', exclude: ['sample-sanitation'], education: [] })
    const picked = build(careers, { ...MUSTER, 'career-2.start.career': 'sample-recycling', 'career-2.start.assignment': 'debris-sweep' }, {}, rules)
    expect(picked.runs[1]?.forced).toBe(false)
    expect(picked.runs[1]?.qualification.dice).toBeDefined()
  })

  // Names the current career and expects a note, no end reason and no forced after-term choice.
  // Criteria: ED-27.
  it('naming the current career is a note', () => {
    const result = build([withEvent7([{ type: 'next-career', career: 'sample-sanitation' }])])
    expect(step(result, 'term-1.event').notes).toContain('The character is already in Sample: Orbital Sanitation, so this changes nothing.')
    expect(result.terms[0]?.endReason).toBeUndefined()
  })
})

// Tests for check keys and option names found in review.
describe('check effect keys and option names', () => {
  // Uses a check whose pass and fail each offer Admin or Science, saves Science for the pass, overrides the
  // check to a fail, and expects the fail's own pick to be asked for.
  // Criteria: ED-26.
  it('pass and fail effects keep separate picks', () => {
    const options = [{ type: 'skill' as const, options: ['Admin', 'Science'] }]
    const career = withEvent7([{ type: 'check', options: ['INT'], target: 8, pass: options, fail: options }])
    const passKey = `${EFFECT}.check.pass.effect-0.skill`
    const pass = build([career], { [passKey]: 'Science' }, { [`${EFFECT}.check`]: 8 })
    expect(pass.skills['Science']).toBe(1)
    const fail = build([career], { [passKey]: 'Science' }, { [`${EFFECT}.check`]: 2 })
    expect(fail.pending).toEqual({ kind: 'skill-option', key: `${EFFECT}.check.fail.effect-0.skill`, options: ['Admin', 'Science'] })
  })

  // Parses checks with the options Int, int and INT, and expects the first two to fail EffectSchema.
  // Criteria: ED-28.
  it('a characteristic option must be in capitals', () => {
    const parse = (option: string) => EffectSchema.safeParse({ type: 'check', options: [option], target: 8 }).success
    expect(parse('Int')).toBe(false)
    expect(parse('int')).toBe(false)
    expect(parse('INT')).toBe(true)
    expect(parse('Admin')).toBe(true)
  })
})
