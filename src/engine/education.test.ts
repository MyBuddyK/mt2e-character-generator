import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { loadEducation, parseEducation, type EducationDefinition } from './education-schema'
import type { Effect } from './effects'
import { finishCareer } from './policy'
import type { Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, removeLastTerm, type CareerData, type CareerInput, type CareerResult, type Step } from './terms'
import { sampleRules } from '../data/rules'
import { educationErrors } from '../data/education'
import sampleCareerJson from '../data/careers/sample-sanitation.json'
import tradeSchoolJson from '../data/education/sample-trade-school.json'
import academyJson from '../data/education/sample-sanitation-academy.json'

// Unit tests for the education term (docs/features/education.md), with the invented sample schools and
// the sample career. BASE has every characteristic at 7, so the DM of each is 0.

const SEED = 'education'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
const TRADE = 'education:sample-trade-school'
const ACADEMY = 'education:sample-sanitation-academy'
/** The trade school picks: Admin at level 0 and Broker at level 1. */
const PICKS = { 'education.skills.pick-0': 'Admin', 'education.skills.pick-1': 'Broker' }
/** Entry passes and the event is roll 7 (a quiet term with no effects). */
const ENTERED = { 'education.entry': 12, 'education.event': 7 }

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

/** Returns `json` parsed with parseEducation, or throws if it does not pass. */
function school(json: unknown): EducationDefinition {
  const result = parseEducation(json)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.education
}

/** An invented second career with one assignment and no qualification DM from the trade school. */
function recycling(): CareerDefinition {
  const career = sampleCareer()
  const first = career.assignments[0]
  if (!first) throw new Error('the sample career has no assignment')
  return { ...career, id: 'sample-recycling', name: 'Sample Recycling', assignments: [first] }
}

/** Returns `edu` with the roll 7 event's effects replaced by `effects`. */
function withEvent7(edu: EducationDefinition, effects: Effect[]): EducationDefinition {
  return { ...edu, events: edu.events.map((e) => (e.roll === 7 ? { ...e, summary: 'Event seven.', effects } : e)) }
}

/** The sample careers and schools with the sample rules, or with `rules` and `education` when given. */
function data(rules: Rules = sampleRules, education: EducationDefinition[] = [school(tradeSchoolJson), school(academyJson)]): CareerData {
  return { careers: [sampleCareer(), recycling()], rules, education }
}

/** Builds with `choices` and `rolls` (and no outcome overrides). */
function build(choices: Record<string, string>, rolls: Record<string, number> = {}, d: CareerData = data(), base = BASE): CareerResult {
  return buildCareer(SEED, base, { ...EMPTY_INPUT, choices, rolls }, d)
}

/** Returns the step with key `key` in any term, or throws when it is missing. */
function step(result: CareerResult, key: string): Step {
  const found = result.terms.flatMap((t) => t.steps).find((s) => s.key === key)
  if (!found) throw new Error(`no step ${key}`)
  return found
}

/** Choices that start the sample career's debris-sweep assignment under `prefix`. */
function startSanitation(prefix: string): Record<string, string> {
  return { [`${prefix}start.career`]: 'sample-sanitation', [`${prefix}start.assignment`]: 'debris-sweep' }
}

// Tests for the education entry and the career pick that offers it.
describe('education entry', () => {
  // Builds with no choices and expects both sample schools offered; then with rules that have no preCareer
  // and expects none; then after a failed graduation in term 1 with lastTerm 1 and with lastTerm 3.
  // Criteria: ED-1.
  it('the career pick offers education in terms 1 to lastTerm only', () => {
    const start = build({}).pending
    expect(start).toMatchObject({ kind: 'start', prefix: '' })
    expect(start?.kind === 'start' ? start.education.map((e) => e.name) : []).toEqual(['Sample: Orbital Trade School', 'Sample: Sanitation Academy'])
    const { preCareer: _unused, ...noPreCareer } = sampleRules
    expect(build({}, {}, data(noPreCareer)).pending).toMatchObject({ kind: 'start', education: [] })
    const failed = { 'education.entry': 12, 'education.event': 7, 'education.graduation': 2 }
    const oneTerm = build({ 'start.career': TRADE, ...PICKS }, failed, data({ ...sampleRules, preCareer: { lastTerm: 1 } }))
    expect(oneTerm.pending).toMatchObject({ kind: 'start', prefix: 'career-2.', education: [] })
    const threeTerms = build({ 'start.career': TRADE, ...PICKS }, failed)
    expect(threeTerms.pending).toMatchObject({ kind: 'start', prefix: 'career-2.' })
    expect(threeTerms.pending?.kind === 'start' ? threeTerms.pending.education.length : 0).toBe(2)
  })

  // Fails graduation in term 1 and tries the trade school again in term 2 with SOC 9, and expects the term
  // 2 DM, the SOC DM and their reasons on the entry roll.
  // Criteria: ED-2.
  it('entry uses the term DM and characteristic DMs', () => {
    const choices = { 'start.career': TRADE, ...PICKS, 'career-2.start.career': TRADE }
    const rolls = { ...ENTERED, 'education.graduation': 2 }
    const result = build(choices, rolls, data(), { ...BASE, SOC: 9 })
    const entry = result.educations[1]?.entry
    expect(entry?.key).toBe('career-2.education.entry')
    expect(entry?.dm).toBe(0)
    expect(entry?.reasons).toEqual(['DM -1 for an attempt in term 2.', 'DM +1 for SOC 9 or more.'])
    const first = build({ 'start.career': TRADE }, {}, data(), { ...BASE, SOC: 9 }).educations[0]?.entry
    expect(first?.dm).toBe(1)
  })

  // Fails the entry roll, and expects no term, the failed-entry outcome, and a career pick for term 1 with
  // no education offered; picking the sample career then plays its term 1 as term 1.
  // Criteria: ED-3.
  it('a failed entry returns to the career pick for the same term', () => {
    const result = build({ 'start.career': TRADE }, { 'education.entry': 2 })
    expect(result.terms).toEqual([])
    expect(result.educations[0]?.outcome).toBe('failed-entry')
    expect(result.pending).toEqual({ kind: 'start', prefix: 'career-2.', exclude: [], failedQualification: false, education: [] })
    const career = build({ 'start.career': TRADE, ...startSanitation('career-2.') }, { 'education.entry': 2 })
    expect(career.terms[0]?.key).toBe('career-2.term-1')
    expect(career.terms[0]?.number).toBe(1)
  })
})

// Tests for the education term.
describe('education term', () => {
  // Enters the trade school and expects a pick for each level, then Admin 0 and Broker 1 and EDU +1 on entry;
  // enters the academy and expects every Service Skill of the sample career at level 0.
  // Criteria: ED-4.
  it('gives picked skills at their levels, or the tied career’s Service Skills at 0', () => {
    const asks = build({ 'start.career': TRADE }, ENTERED)
    expect(asks.pending).toEqual({
      kind: 'skill-option',
      key: 'education.skills.pick-0',
      options: ['Mechanic', 'Electronics', 'Engineer', 'Admin', 'Broker', 'Vacc Suit'],
    })
    const second = build({ 'start.career': TRADE, 'education.skills.pick-0': 'Admin' }, ENTERED).pending
    expect(second?.kind === 'skill-option' ? second.options : []).not.toContain('Admin')
    const picked = build({ 'start.career': TRADE, ...PICKS }, { ...ENTERED, 'education.graduation': 2 })
    expect(picked.skills).toEqual({ Admin: 0, Broker: 1 })
    expect(step(picked, 'education.skills').applied).toContain('EDU +1')
    const academy = build({ 'start.career': ACADEMY }, { ...ENTERED, 'education.graduation': 2 })
    expect(academy.skills).toEqual({ 'Vacc Suit': 0, Pilot: 0, Mechanic: 0, Electronics: 0, Broker: 0, Steward: 0 })
  })

  // Enters the trade school with the event at 4 (gain Mechanic), and expects one event step with Mechanic
  // applied.
  // Criteria: ED-5.
  it('rolls once on the education’s events table', () => {
    const result = build({ 'start.career': TRADE, ...PICKS }, { ...ENTERED, 'education.event': 4, 'education.graduation': 8 })
    const events = result.terms[0]?.steps.filter((s) => s.label === 'Event') ?? []
    expect(events.map((s) => s.key)).toEqual(['education.event'])
    expect(result.skills['Mechanic']).toBe(1)
  })

  // Uses the event at 2 (fail graduation), and then a school whose event 7 sends the character to the
  // sample recycling career, and expects the graduation step not rolled, no benefits and no bonuses.
  // Criteria: ED-6.
  it('fail-graduation or next-career skips graduation', () => {
    const failed = build({ 'start.career': TRADE, ...PICKS }, { ...ENTERED, 'education.event': 2 })
    expect(step(failed, 'education.graduation').reasons).toEqual(['An event failed graduation.'])
    expect(step(failed, 'education.graduation').dice).toBeUndefined()
    expect(failed.educations[0]?.outcome).toBe('failed')
    expect(failed.educations[0]?.bonuses).toEqual([])
    expect(failed.skills).toEqual({ Admin: 0, Broker: 1 })
    const sent = withEvent7(school(tradeSchoolJson), [{ type: 'next-career', career: 'sample-recycling' }])
    const forced = build({ 'start.career': TRADE, ...PICKS }, ENTERED, data(sampleRules, [sent]))
    expect(step(forced, 'education.graduation').reasons).toEqual(['An event sends the character to another career next term.'])
    expect(forced.educations[0]?.outcome).toBe('failed')
    expect(forced.runs[0]?.career.id).toBe('sample-recycling')
    expect(forced.runs[0]?.forced).toBe(true)
  })

  // Rolls graduation 12 (honours at 10), 8 and 2, and expects honours with both EDU gains and the raised
  // skills, a pass with one EDU gain, and a fail that keeps the entry skills and gives nothing more.
  // Criteria: ED-7.
  it('graduation gives honours, normal benefits, or none', () => {
    const choices = { 'start.career': TRADE, ...PICKS }
    const honours = build(choices, { ...ENTERED, 'education.graduation': 12 })
    expect(honours.educations[0]?.outcome).toBe('honours')
    expect(honours.characteristicChanges.EDU).toBe(3)
    expect(honours.skills).toEqual({ Admin: 1, Broker: 2 })
    const pass = build(choices, { ...ENTERED, 'education.graduation': 8 })
    expect(pass.educations[0]?.outcome).toBe('graduated')
    expect(pass.characteristicChanges.EDU).toBe(2)
    expect(pass.skills).toEqual({ Admin: 1, Broker: 2 })
    const fail = build(choices, { ...ENTERED, 'education.graduation': 2 })
    expect(fail.educations[0]?.outcome).toBe('failed')
    expect(fail.characteristicChanges.EDU).toBe(1)
    expect(fail.skills).toEqual({ Admin: 0, Broker: 1 })
  })
})

// Tests for the bonuses graduation gives the next career.
describe('graduation bonuses', () => {
  const GRADUATE = { 'start.career': TRADE, ...PICKS }
  const GRADUATED = { ...ENTERED, 'education.graduation': 8 }

  // Graduates from the trade school (DM +1 for the sample career), then enters the sample career and expects
  // the DM and its reason; enters sample recycling instead and expects none; and after recycling, a third
  // career of the sample career gets no DM either.
  // Criteria: ED-8.
  it('the qualification DM applies only to listed careers, and only next', () => {
    const listed = build({ ...GRADUATE, ...startSanitation('career-2.') }, GRADUATED)
    expect(listed.runs[0]?.qualification.reasons).toContain('DM +1 from graduating from Sample: Orbital Trade School.')
    expect(listed.runs[0]?.qualification.dm).toBe(1)
    const other = { ...GRADUATE, 'career-2.start.career': 'sample-recycling', 'career-2.start.assignment': 'debris-sweep' }
    const unlisted = build(other, GRADUATED)
    expect(unlisted.runs[0]?.qualification.dm).toBe(0)
    const later = build(
      { ...other, 'career-2.term-1.skill-0.table': 'serviceSkills', 'career-2.term-1.next': 'leave', 'career-2.benefit-0': 'benefit', ...startSanitation('career-3.') },
      { ...GRADUATED, 'career-2.qualification': 12, 'career-2.term-1.survival': 12, 'career-2.term-1.event': 7, 'career-2.term-1.advancement': 2 },
    )
    expect(later.runs[1]?.career.id).toBe('sample-sanitation')
    expect(later.runs[1]?.qualification.dm).toBe(0)
  })

  // Uses a school whose commission bonus lists a career with a commission check, graduates, enters that
  // career, and expects the education commission roll in term 1 to make the character officer rank 1 with no
  // usual commission choice; with honours the commission passes with no roll.
  // Criteria: ED-9.
  it('a pre-career commission roll makes the character an officer', () => {
    const base = sampleCareer()
    const navy: CareerDefinition = {
      ...base,
      id: 'sample-navy',
      name: 'Sample Navy',
      commission: { characteristic: 'SOC', target: 8 },
      officerRanks: [{ rank: 1, title: 'Ensign' }],
    }
    const trade = school(tradeSchoolJson)
    const edu: EducationDefinition = { ...trade, benefits: { ...trade.benefits, commission: { careers: ['sample-navy'], dm: 0, honoursAutomatic: true } } }
    const rules: Rules = { ...sampleRules, commission: { anyTermFromSOC: 9, dmPerLaterTerm: -1 } }
    const d: CareerData = { careers: [base, navy], rules, education: [edu] }
    const choices = { ...GRADUATE, 'career-2.start.career': 'sample-navy', 'career-2.start.assignment': 'debris-sweep' }
    const rolled = build(choices, { ...GRADUATED, 'career-2.qualification': 12, 'career-2.term-1.education-commission': 12 }, d)
    const commission = step(rolled, 'career-2.term-1.education-commission')
    expect(commission.dice).toBeDefined()
    expect(commission.result).toBe('pass')
    expect(step(rolled, 'career-2.term-1.officer-rank-1').result).toBe('Officer rank 1 Ensign')
    expect(rolled.runs[0]?.officerRank).toBe(1)
    expect(rolled.pending).toMatchObject({ kind: 'skill-table' })
    const honours = build(choices, { ...ENTERED, 'education.graduation': 12, 'career-2.qualification': 12 }, d)
    expect(step(honours, 'career-2.term-1.education-commission').dice).toBeUndefined()
    expect(honours.runs[0]?.officerRank).toBe(1)
  })

  // Graduates from the academy, enters the sample career, and expects no qualification roll, then three
  // Service Skill picks raised to 1.
  // Criteria: ED-10.
  it('an academy graduate enters the tied career with three Service Skills at 1', () => {
    const choices = { 'start.career': ACADEMY, ...startSanitation('career-2.') }
    const rolls = { ...ENTERED, 'education.graduation': 8 }
    const asks = build(choices, rolls)
    expect(asks.runs[0]?.qualification.dice).toBeUndefined()
    expect(asks.runs[0]?.qualification.reasons).toEqual(['Automatic entry after Sample: Sanitation Academy.'])
    expect(asks.pending).toMatchObject({ kind: 'skill-option', key: 'career-2.term-1.academy-skills.pick-0' })
    const picks = {
      'career-2.term-1.academy-skills.pick-0': 'Pilot',
      'career-2.term-1.academy-skills.pick-1': 'Mechanic',
      'career-2.term-1.academy-skills.pick-2': 'Broker',
    }
    const done = build({ ...choices, ...picks }, rolls)
    expect(step(done, 'career-2.term-1.academy-skills').applied).toHaveLength(3)
    expect(done.skills['Pilot']).toBe(1)
    expect(done.skills['Mechanic']).toBe(1)
    expect(done.skills['Broker']).toBe(1)
    expect(done.skills['Steward']).toBe(0)
  })

  // Fails academy graduation with dice of 3, and expects entry to the sample career with no roll and no
  // Service Skills step; with dice of 2, the qualification is rolled as usual.
  // Criteria: ED-11.
  it('a failed academy graduation above the threshold still enters the tied career', () => {
    const choices = { 'start.career': ACADEMY, ...startSanitation('career-2.') }
    const three = build(choices, { ...ENTERED, 'education.graduation': 3 })
    expect(three.educations[0]?.outcome).toBe('failed')
    expect(three.runs[0]?.qualification.dice).toBeUndefined()
    expect(three.terms[1]?.steps.map((s) => s.key)).not.toContain('career-2.term-1.academy-skills')
    const two = build(choices, { ...ENTERED, 'education.graduation': 2 })
    expect(two.runs[0]?.qualification.dice).toBeDefined()
    expect(step(two, 'education.graduation').reasons).toContain('Dice of 2 (2 or less) lose the entry to Sample: Orbital Sanitation.')
  })

  // Fails entry to the trade school, is drafted into the sample career, then enters the school (offered again
  // after the failed entry) whose event 7 sends the character to the Draft, and expects a third career that
  // is drafted and forced.
  // Criteria: ED-12.
  it('next-career to the Draft in education drafts again', () => {
    const rules: Rules = { ...sampleRules, draft: [{ roll: 1, career: 'sample-sanitation', assignment: 'hazmat' }] }
    const edu = withEvent7(school(tradeSchoolJson), [{ type: 'next-career', career: 'draft' }])
    const choices = {
      'start.career': TRADE,
      ...startSanitation('career-2.'),
      'career-2.fallback': 'draft',
      'career-2.term-1.skill-0.table': 'serviceSkills',
      'career-2.term-1.next': 'leave',
      'career-2.benefit-0': 'benefit',
      'career-3.start.career': TRADE,
      'career-3.education.skills.pick-0': 'Admin',
      'career-3.education.skills.pick-1': 'Broker',
    }
    const rolls = {
      'education.entry': 2,
      'career-2.qualification': 2,
      'career-2.term-1.survival': 12,
      'career-2.term-1.event': 7,
      'career-2.term-1.advancement': 2,
      'career-3.education.entry': 12,
      'career-3.education.event': 7,
    }
    const result = build(choices, rolls, data(rules, [edu]))
    expect(result.educations[1]?.outcome).toBe('failed')
    expect(result.runs[0]?.entry).toBe('draft')
    expect(result.runs[1]?.forced).toBe(true)
    expect(result.runs[1]?.entry).toBe('draft')
    expect(result.runs[1]?.draft?.key).toBe('career-4.draft')
  })
})

// Tests for removal, Finish career and age with education.
describe('education with removal, Finish career and age', () => {
  // Graduates, plays term 1 of the sample career, removes it and expects the career pick after the
  // education with the bonuses listed; removes again and expects nothing chosen.
  // Criteria: ED-13.
  it('removing terms goes back through the education term', () => {
    const d = data()
    const full: CareerInput = {
      ...EMPTY_INPUT,
      choices: { 'start.career': TRADE, ...PICKS, ...startSanitation('career-2.'), 'career-2.term-1.skill-0.table': 'serviceSkills' },
      rolls: { ...ENTERED, 'education.graduation': 8 },
    }
    expect(buildCareer(SEED, BASE, full, d).terms).toHaveLength(2)
    const first = removeLastTerm(SEED, BASE, full, d)
    if (!first) throw new Error('nothing removed')
    const back = buildCareer(SEED, BASE, first.input, d)
    expect(back.terms).toHaveLength(1)
    expect(back.pending).toMatchObject({ kind: 'start', prefix: 'career-2.' })
    expect(back.educations[0]?.bonuses).toEqual(['DM +1 to qualify for Sample: Orbital Sanitation as the next career.'])
    const second = removeLastTerm(SEED, BASE, first.input, d)
    expect(second?.input).toEqual(EMPTY_INPUT)
  })

  // Runs Finish career at the first career pick and expects no choice made; picks the trade school and runs
  // Finish career, and expects it to stop at the career pick after the education term.
  // Criteria: ED-14.
  it('Finish career never picks education, and plays an education term through', () => {
    const d = data()
    expect(finishCareer(SEED, BASE, EMPTY_INPUT, d)).toEqual(EMPTY_INPUT)
    const finished = finishCareer(SEED, BASE, { ...EMPTY_INPUT, choices: { 'start.career': TRADE }, rolls: { 'education.entry': 12 } }, d)
    const result = buildCareer(SEED, BASE, finished, d)
    expect(result.educations[0]?.outcome).toBeDefined()
    expect(result.pending).toMatchObject({ kind: 'start', prefix: 'career-2.' })
  })

  // Plays the trade school with aging from term 1, and expects ages 18 to 22, an aging step in the education
  // term, and the next career's term 1 starting at 22 as term 2.
  // Criteria: ED-15.
  it('an education term adds a term to the age and counts toward aging', () => {
    const rules: Rules = { ...sampleRules, aging: { ...sampleRules.aging, fromTerm: 1 } }
    const result = build({ 'start.career': TRADE, ...PICKS, ...startSanitation('career-2.') }, { ...ENTERED, 'education.graduation': 8, 'education.aging': 3 }, data(rules))
    expect(result.terms[0]?.ageStart).toBe(18)
    expect(result.terms[0]?.ageEnd).toBe(22)
    expect(step(result, 'education.aging').label).toBe('Aging')
    expect(result.terms[1]?.number).toBe(2)
    expect(result.terms[1]?.ageStart).toBe(22)
  })

  // Expects the bundled education files to load with no problems.
  // Criteria: ED-1.
  it('the bundled education files pass EducationSchema', () => {
    expect(educationErrors).toEqual([])
  })
})

// Tests for commission rolls, removal, offering and effects at the edges of an education term.
describe('education edge cases', () => {
  /** The sample career with a SOC 8 commission check and an officer rank 1, and rules with a commission. */
  function withCommission(): { career: CareerDefinition; rules: Rules } {
    const career: CareerDefinition = {
      ...sampleCareer(),
      commission: { characteristic: 'SOC', target: 8 },
      officerRanks: [{ rank: 1, title: 'Ensign' }],
    }
    return { career, rules: { ...sampleRules, commission: { anyTermFromSOC: 9, dmPerLaterTerm: -1 } } }
  }
  /** Term 1 choices and rolls that play the sample career under career-2. up to its commission choice. */
  const TERM_1 = { 'career-2.term-1.skill-0.table': 'serviceSkills' }
  const TERM_1_ROLLS = { 'career-2.term-1.survival': 12, 'career-2.term-1.event': 7 }

  // Fails academy graduation with dice of 3 and enters the tied career, which has a commission check, and
  // expects term 1 to go past the commission with no commission choice; a graduate gets the choice.
  // Criteria: ED-29.
  it('a failed academy graduation gives no commission roll in the tied career’s first term', () => {
    const { career, rules } = withCommission()
    const d: CareerData = { careers: [career], rules, education: [school(academyJson)] }
    const choices = { 'start.career': ACADEMY, ...startSanitation('career-2.'), ...TERM_1 }
    const failed = build(choices, { ...ENTERED, 'education.graduation': 3, ...TERM_1_ROLLS }, d)
    expect(failed.educations[0]?.outcome).toBe('failed')
    expect(failed.pending?.kind).not.toBe('commission')
    expect(failed.terms[1]?.steps.map((st) => st.key)).not.toContain('career-2.term-1.commission')
    const picks = {
      'career-2.term-1.academy-skills.pick-0': 'Pilot',
      'career-2.term-1.academy-skills.pick-1': 'Mechanic',
      'career-2.term-1.academy-skills.pick-2': 'Broker',
    }
    const graduate = build({ ...choices, ...picks }, { ...ENTERED, 'education.graduation': 8, ...TERM_1_ROLLS }, d)
    expect(graduate.pending).toMatchObject({ kind: 'commission', key: 'career-2.term-1.commission.try' })
  })

  // Graduates from a school whose commission bonus lists the career, fails that commission roll, and
  // expects no second commission choice in term 1.
  // Criteria: ED-30.
  it('a failed education commission takes the place of term 1’s commission roll', () => {
    const { career, rules } = withCommission()
    const trade = school(tradeSchoolJson)
    const edu: EducationDefinition = { ...trade, benefits: { ...trade.benefits, commission: { careers: [career.id], dm: 0 } } }
    const d: CareerData = { careers: [career], rules, education: [edu] }
    const choices = { 'start.career': TRADE, ...PICKS, ...startSanitation('career-2.'), ...TERM_1 }
    const rolls = { ...ENTERED, 'education.graduation': 8, 'career-2.qualification': 12, 'career-2.term-1.education-commission': 2, ...TERM_1_ROLLS }
    const result = build(choices, rolls, d)
    expect(step(result, 'career-2.term-1.education-commission').result).toBe('fail')
    expect(result.pending?.kind).not.toBe('commission')
    expect(result.runs[0]?.officerRank).toBeUndefined()
  })

  // Enters a school whose event 7 sends the character to the sample career, plays the forced career's
  // term 1, removes it, and expects the education term removed too, with nothing chosen.
  // Criteria: ED-31.
  it('removing a forced career’s first term after education removes the education term too', () => {
    const edu = withEvent7(school(tradeSchoolJson), [{ type: 'next-career', career: 'sample-sanitation' }])
    const d = data(sampleRules, [edu])
    const input: CareerInput = {
      ...EMPTY_INPUT,
      choices: { 'start.career': TRADE, ...PICKS, 'career-2.assignment': 'debris-sweep', ...TERM_1 },
      rolls: { ...ENTERED, ...TERM_1_ROLLS },
    }
    const full = buildCareer(SEED, BASE, input, d)
    expect(full.runs[0]?.forced).toBe(true)
    expect(full.terms).toHaveLength(2)
    const removal = removeLastTerm(SEED, BASE, input, d)
    expect(removal?.removed).toBe(1)
    expect(removal?.input).toEqual(EMPTY_INPUT)
  })

  // Plays term 1 of the sample career and leaves, and expects the next career pick (nextCareer) to offer no
  // education; after a failed entry and the same career term, it offers both schools.
  // Criteria: ED-32.
  it('after a career, education is offered only when an earlier entry failed', () => {
    const career = {
      'career-2.term-1.skill-0.table': 'serviceSkills',
      'career-2.term-1.next': 'leave',
      'career-2.benefit-0': 'benefit',
    }
    const rolls = { 'career-2.qualification': 12, 'career-2.term-1.survival': 12, 'career-2.term-1.event': 7, 'career-2.term-1.advancement': 2 }
    const plain = Object.fromEntries(Object.entries({ ...startSanitation('career-2.'), ...career }).map(([k, v]) => [k.replace(/^career-2\./, ''), v]))
    const plainRolls = Object.fromEntries(Object.entries(rolls).map(([k, v]) => [k.replace(/^career-2\./, ''), v]))
    const noEntry = build(plain, plainRolls)
    expect(noEntry.nextCareer).toEqual({ prefix: 'career-2.', exclude: ['sample-sanitation'], education: [] })
    const afterFailed = build({ 'start.career': TRADE, ...startSanitation('career-2.'), ...career }, { 'education.entry': 2, ...rolls })
    expect(afterFailed.nextCareer?.prefix).toBe('career-3.')
    expect(afterFailed.nextCareer?.education.map((e) => e.id)).toEqual(['sample-trade-school', 'sample-sanitation-academy'])
  })

  // Sets the trade school's event 7 to "promote" and "extra-benefit", and expects one note for each on the
  // event step, no rank, and the same result as a quiet event otherwise.
  // Criteria: ED-33.
  it('career-only effects in an education event are notes', () => {
    const edu = withEvent7(school(tradeSchoolJson), [{ type: 'promote' }, { type: 'extra-benefit' }])
    const result = build({ 'start.career': TRADE, ...PICKS }, { ...ENTERED, 'education.graduation': 8 }, data(sampleRules, [edu]))
    expect(step(result, 'education.event').notes).toEqual([
      'Apply "promote" by hand: it needs a career, and this is an education term.',
      'Apply "extra-benefit" by hand: it needs a career, and this is an education term.',
    ])
    const quiet = build({ 'start.career': TRADE, ...PICKS }, { ...ENTERED, 'education.graduation': 8 })
    expect(result.skills).toEqual(quiet.skills)
    expect(result.pending).toEqual(quiet.pending)
  })

  // Saves an education id no loaded pack has as the career pick, and expects one problem that names it.
  // Criteria: ED-34.
  it('a saved education that can’t be picked gives one problem', () => {
    const result = build({ 'start.career': 'education:missing-school' })
    expect(result.problems).toEqual([`The saved education "missing-school" can't be picked for this term.`])
    expect(result.pending).toMatchObject({ kind: 'start', prefix: '' })
  })

  // Loads two files with the same education id and one that fails, and expects the first by file name order
  // kept, and a message for the duplicate and for the failing file.
  // Criteria: ED-35.
  it('loadEducation leaves out a repeated id and a failing file', () => {
    const result = loadEducation({ './b.json': tradeSchoolJson, './a.json': tradeSchoolJson, './c.json': { id: 'broken' } })
    expect(result.education.map((e) => e.id)).toEqual(['sample-trade-school'])
    expect(result.errors[0]).toBe('./b.json: id "sample-trade-school" is already used by ./a.json')
    expect(result.errors.slice(1).every((e) => e.startsWith('./c.json: '))).toBe(true)
    expect(result.errors.length).toBeGreaterThan(1)
  })
})
