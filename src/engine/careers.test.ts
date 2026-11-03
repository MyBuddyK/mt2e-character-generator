import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { RulesSchema, type Rules } from './rules-schema'
import { finishCareer, policyChoice } from './policy'
import { buildCareer, EMPTY_INPUT, type CareerInput, type CareerResult } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'

// Unit tests for part 2b (docs/features/career-rules.md): careers one after another, the Draft and
// the fallback career, and commissions. Every career here is built from the invented sample career.

/** Returns the sample career parsed with parseCareer, with `id` and `name` replaced when given, or throws if it does not pass. */
function career(id = 'sample-sanitation', name = 'Sample: Orbital Sanitation', extra: Partial<CareerDefinition> = {}): CareerDefinition {
  const result = parseCareer({ ...sampleCareerJson, id, name })
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return { ...result.career, ...extra }
}

const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
const SEED = 'careers'
const FIRST = career()
const SECOND = career('second', 'Second career')
const DRIFT = career('drift', 'Drift', { qualification: { characteristic: 'END', target: 2, automatic: true } })

/**
 * Choices and rolls for a first career in the sample career's debris-sweep assignment that passes
 * qualification, survives term 1, leaves after it and takes one benefit roll on the benefit table.
 */
const FIRST_CAREER: CareerInput = {
  ...EMPTY_INPUT,
  choices: {
    'start.career': 'sample-sanitation',
    'start.assignment': 'debris-sweep',
    'term-1.skill-0.table': 'serviceSkills',
    'term-1.next': 'leave',
    'benefit-0': 'benefit',
  },
  rolls: { qualification: 12, 'term-1.survival': 12, 'term-1.advancement': 2 },
}

/** Returns FIRST_CAREER plus `choices` and `rolls`. */
function withFirst(choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerInput {
  return { ...FIRST_CAREER, choices: { ...FIRST_CAREER.choices, ...choices }, rolls: { ...FIRST_CAREER.rolls, ...rolls } }
}

/** Choices that start the second career in its debris-sweep assignment. */
const START_SECOND = { 'career-2.start.career': 'second', 'career-2.start.assignment': 'debris-sweep' }

/** Builds with `careers` (FIRST, SECOND and DRIFT by default) and `rules` (the sample rules by default). */
function build(input: CareerInput, rules: Rules = sampleRules, careers: CareerDefinition[] = [FIRST, SECOND, DRIFT]): CareerResult {
  return buildCareer(SEED, BASE, input, { careers, rules })
}

// Tests for entering one career after another.
describe('careers one after another', () => {
  // Musters out of the first career and expects the character finished, nothing pending, and the next
  // career's prefix with the career just left excluded.
  // Criteria: CR-19.
  it('offers a next career after mustering out', () => {
    const result = build(FIRST_CAREER)
    expect(result.finished).toBe(true)
    expect(result.pending).toBeUndefined()
    expect(result.nextCareer).toEqual({ prefix: 'career-2.', exclude: ['sample-sanitation'] })
    expect(result.runs).toHaveLength(1)
  })

  // Starts the second career and expects its first term to be term 2 overall, term 1 in the career,
  // with "career-2." keys and the age continuing from the first career.
  // Criteria: CR-19.
  it('numbers terms across careers and prefixes the later career keys', () => {
    const result = build(withFirst({ ...START_SECOND }, { 'career-2.qualification': 12 }))
    expect(result.finished).toBe(false)
    expect(result.runs.map((r) => r.career.id)).toEqual(['sample-sanitation', 'second'])
    const term = result.terms[1]
    expect(term?.number).toBe(2)
    expect(term?.careerTerm).toBe(1)
    expect(term?.ageStart).toBe(sampleRules.startingAge + sampleRules.termLength)
    expect(term?.steps[0]?.key).toBe('career-2.term-1.training')
  })

  // Picks the first career again as the next career and expects a problem, no second career, and the
  // character still finished.
  // Criteria: CR-19.
  it('does not allow re-entering the career just left', () => {
    const result = build(withFirst({ 'career-2.start.career': 'sample-sanitation', 'career-2.start.assignment': 'debris-sweep' }))
    expect(result.runs).toHaveLength(1)
    expect(result.finished).toBe(true)
    expect(result.problems.join(' ')).toContain("can't be entered again")
  })

  // With dmPerPreviousCareer -1, expects the second career's qualification DM to be the END DM (0) - 1
  // and the step to give the reason.
  // Criteria: CR-20.
  it('applies the qualification DM for each earlier career', () => {
    const rules: Rules = { ...sampleRules, qualification: { dmPerPreviousCareer: -1 } }
    const qualification = build(withFirst(START_SECOND), rules).runs[1]?.qualification
    expect(qualification?.dm).toBe(-1)
    expect(qualification?.reasons).toContain('DM -1 for 1 earlier career.')
  })

  // Starts the second career and expects basic training to ask for one skill from the service skills
  // table, then gives the picked skill only.
  // Criteria: CR-21.
  it('gives a later career one basic training skill, picked by the player', () => {
    const asked = build(withFirst(START_SECOND, { 'career-2.qualification': 12 }))
    expect(asked.pending).toEqual({
      kind: 'skill-option',
      key: 'career-2.term-1.training.pick',
      options: FIRST.skillTables.serviceSkills,
    })
    const picked = build(withFirst({ ...START_SECOND, 'career-2.term-1.training.pick': 'Broker' }, { 'career-2.qualification': 12 }))
    expect(picked.terms[1]?.steps[0]?.applied).toEqual([`Broker ${sampleRules.basicTraining.level}`])
  })

  // With a cash limit of 1, takes cash in the first career and expects the second career's benefit
  // roll to forbid cash.
  // Criteria: CR-22.
  it('counts the cash roll limit across careers', () => {
    const rules: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, cashRollLimit: 1 } }
    const input = withFirst(
      { 'benefit-0': 'cash', ...START_SECOND, 'career-2.term-1.training.pick': 'Broker', 'career-2.term-1.skill-0.table': 'serviceSkills', 'career-2.term-1.next': 'leave' },
      { 'career-2.qualification': 12, 'career-2.term-1.survival': 12, 'career-2.term-1.advancement': 2 },
    )
    expect(build(input, rules).pending).toMatchObject({ kind: 'benefit', key: 'career-2.benefit-0', cashAllowed: false })
  })

  // Finishes the first career with the policy and expects it to stop at the next-career choice with
  // nothing chosen for the second career.
  it('Finish career stops before the next career', () => {
    const input = finishCareer(SEED, BASE, { ...EMPTY_INPUT, choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep' }, rolls: { qualification: 12 } }, { careers: [FIRST, SECOND], rules: sampleRules })
    const result = build(input)
    expect(result.finished).toBe(true)
    expect(Object.keys(input.choices).some((k) => k.startsWith('career-2.'))).toBe(false)
  })

  // Asks the policy about the after-term choice in a second career with one term, with a term limit of
  // 1, and expects "leave": the limit counts the current career's terms only.
  // Criteria: CR-27.
  it('Finish career counts the term limit per career', () => {
    const result = build(
      withFirst({ ...START_SECOND, 'career-2.term-1.training.pick': 'Broker', 'career-2.term-1.skill-0.table': 'serviceSkills' }, { 'career-2.qualification': 12, 'career-2.term-1.survival': 12, 'career-2.term-1.advancement': 2 }),
    )
    expect(result.pending).toMatchObject({ kind: 'next', key: 'career-2.term-1.next' })
    if (!result.pending) throw new Error('nothing pending')
    expect(policyChoice(result.pending, result, 1, SEED)).toBe('leave')
    expect(policyChoice(result.pending, result, 2, SEED)).toBe('continue')
  })
})

/** Rules with a Draft table whose rows all send the character to the second career, and Drift as the fallback career. */
const DRAFT_RULES: Rules = {
  ...sampleRules,
  draft: [1, 2, 3, 4, 5, 6].map((roll) => (roll === 6 ? { roll, career: 'second', assignment: 'hazmat' } : { roll, career: 'second' })),
  fallbackCareer: 'drift',
}

/** An input that starts the first career and fails its qualification roll. */
const FAILED: CareerInput = { ...EMPTY_INPUT, choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep' }, rolls: { qualification: 2 } }

// Tests for the Draft and the fallback career after a failed qualification.
describe('the Draft and the fallback career', () => {
  // Fails qualification with Draft and fallback rules and expects the fallback choice with both offered.
  // Criteria: CR-23.
  it('offers the Draft and the fallback career when qualification fails', () => {
    expect(build(FAILED, DRAFT_RULES).pending).toEqual({ kind: 'fallback', key: 'fallback', draftAllowed: true, fallback: 'Drift' })
  })

  // Fails qualification without Draft or fallback rules and expects the start choice again, as before part 2b.
  // Criteria: CR-24.
  it('asks for a career again when the rules have neither', () => {
    expect(build(FAILED).pending).toMatchObject({ kind: 'start', failedQualification: true })
  })

  // Picks the fallback career and expects the run to serve Drift (one of three assignments to pick),
  // with entry "fallback" and the applied career kept.
  it('enters the fallback career without a roll', () => {
    const asked = build({ ...FAILED, choices: { ...FAILED.choices, fallback: 'fallback' } }, DRAFT_RULES)
    expect(asked.pending).toMatchObject({ kind: 'assignment', key: 'assignment', careerName: 'Drift' })
    const result = build({ ...FAILED, choices: { ...FAILED.choices, fallback: 'fallback', assignment: 'hazmat' } }, DRAFT_RULES)
    const run = result.runs[0]
    expect(run?.entry).toBe('fallback')
    expect(run?.applied.id).toBe('sample-sanitation')
    expect(run?.career.id).toBe('drift')
    expect(run?.assignment?.id).toBe('hazmat')
    expect(result.terms).toHaveLength(1)
  })

  // Takes the Draft with the roll set to 6 and expects the second career in the hazmat assignment
  // named by the row, with no assignment choice.
  // Criteria: CR-23.
  it('the Draft uses the career and assignment of the row rolled', () => {
    const result = build({ ...FAILED, choices: { ...FAILED.choices, fallback: 'draft' }, rolls: { ...FAILED.rolls, draft: 6 } }, DRAFT_RULES)
    const run = result.runs[0]
    expect(run?.entry).toBe('draft')
    expect(run?.draft?.result).toBe('Second career')
    expect(run?.career.id).toBe('second')
    expect(run?.assignment?.id).toBe('hazmat')
  })

  // Takes the Draft in the first career, then fails the qualification of the next career, and expects
  // only the fallback career offered.
  // Criteria: CR-23.
  it('the Draft can be taken once per character', () => {
    const drafted: CareerInput = {
      ...EMPTY_INPUT,
      choices: {
        ...FAILED.choices,
        fallback: 'draft',
        'term-1.skill-0.table': 'serviceSkills',
        'term-1.next': 'leave',
        'benefit-0': 'benefit',
        'career-2.start.career': 'sample-sanitation',
        'career-2.start.assignment': 'debris-sweep',
      },
      rolls: { ...FAILED.rolls, draft: 6, 'term-1.survival': 12, 'term-1.advancement': 2, 'career-2.qualification': 2 },
    }
    expect(build(drafted, DRAFT_RULES).pending).toEqual({ kind: 'fallback', key: 'career-2.fallback', draftAllowed: false, fallback: 'Drift' })
  })

  // Asks the policy about the fallback and assignment choices and expects no answer (the player decides).
  it('Finish career leaves the fallback and assignment choices to the player', () => {
    const result = build(FAILED, DRAFT_RULES)
    expect(policyChoice({ kind: 'fallback', key: 'fallback', draftAllowed: true, fallback: 'Drift' }, result, 5, SEED)).toBeUndefined()
    expect(policyChoice({ kind: 'assignment', key: 'assignment', careerName: 'Drift', options: [] }, result, 5, SEED)).toBeUndefined()
  })
})

/** The second career's events table with every row replaced by a summary with no effects. */
const QUIET_EVENTS = FIRST.events.map((e) => ({ roll: e.roll, summary: e.summary }))

/** A career with a SOC 8+ commission, two officer ranks and an officer skill table. */
const MILITARY = career('military', 'Military', {
  events: QUIET_EVENTS,
  commission: { characteristic: 'SOC', target: 8 },
  officerRanks: [
    { rank: 1, title: 'Lieutenant' },
    { rank: 2, title: 'Captain' },
  ],
  skillTables: { ...FIRST.skillTables, officer: ['Leadership', 'Tactics', 'Admin', 'Diplomat', 'Advocate', 'Electronics'] },
})
const COMMISSION_RULES: Rules = { ...sampleRules, commission: { anyTermFromSOC: 9, dmPerLaterTerm: -1 } }

/** Returns an input that starts the military career, passes qualification and survives terms 1 and 2, plus `choices` and `rolls`. */
function military(choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerInput {
  return {
    ...EMPTY_INPUT,
    choices: { 'start.career': 'military', 'start.assignment': 'debris-sweep', 'term-1.skill-0.table': 'serviceSkills', ...choices },
    rolls: { qualification: 12, 'term-1.survival': 12, 'term-2.survival': 12, 'term-1.event': 7, 'term-2.event': 7, ...rolls },
  }
}

/** Builds the military career from `input` with the commission rules and `base` characteristics (BASE by default). */
function buildMilitary(input: CareerInput, base = BASE): CareerResult {
  return buildCareer(SEED, base, input, { careers: [MILITARY], rules: COMMISSION_RULES })
}

// Tests for commissions and officer ranks.
describe('commissions', () => {
  // Survives term 1 of a career with a commission and expects the commission choice before advancement.
  // Criteria: CR-25.
  it('offers a commission in the first term', () => {
    expect(buildMilitary(military()).pending).toEqual({ kind: 'commission', key: 'term-1.commission.try' })
  })

  // Tries for a commission with dice 12 and expects officer rank 1 Lieutenant, no advancement roll,
  // and the officer skill table offered for the advancement skill roll.
  // Criteria: CR-25.
  it('a commission makes the character a rank 1 officer and replaces advancement', () => {
    const result = buildMilitary(military({ 'term-1.commission.try': 'try' }, { 'term-1.commission': 12 }))
    const term = result.terms[0]
    expect(term?.officer).toBe(true)
    expect(term?.rank).toBe(1)
    expect(term?.title).toBe('Lieutenant')
    expect(term?.steps.some((s) => s.key === 'term-1.advancement')).toBe(false)
    expect(result.pending).toMatchObject({ kind: 'skill-table', key: 'term-1.advancement-skill-0.table' })
    if (result.pending?.kind !== 'skill-table') throw new Error('no skill table pending')
    expect(result.pending.options).toContain('officer')
  })

  // Skips the commission and expects the advancement roll as usual, and the officer table not offered.
  it('skipping the commission rolls advancement', () => {
    const result = buildMilitary(military({ 'term-1.commission.try': 'skip' }, { 'term-1.advancement': 12 }))
    expect(result.terms[0]?.officer).toBe(false)
    expect(result.terms[0]?.rank).toBe(1)
    if (result.pending?.kind !== 'skill-table') throw new Error('no skill table pending')
    expect(result.pending.options).not.toContain('officer')
  })

  // Continues to term 2 with SOC 7, then with SOC 9, and expects the commission offered only with SOC
  // 9, with DM -1 for the later term (SOC 9 gives DM +1, so the total DM is 0).
  // Criteria: CR-25.
  it('later terms allow a commission only from the SOC in the rules', () => {
    const choices = { 'term-1.commission.try': 'skip', 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' }
    const rolls = { 'term-1.advancement': 3 }
    expect(buildMilitary(military(choices, rolls)).pending?.kind).not.toBe('commission')
    const high = { ...BASE, SOC: 9 }
    expect(buildMilitary(military(choices, rolls), high).pending).toEqual({ kind: 'commission', key: 'term-2.commission.try' })
    const tried = buildMilitary(military({ ...choices, 'term-2.commission.try': 'try' }, rolls), high)
    const step = tried.terms[1]?.steps.find((s) => s.key === 'term-2.commission')
    expect(step?.dm).toBe(0)
    expect(step?.reasons).toContain('DM -1 for 1 term after the first.')
  })

  // Commissions at enlisted rank 0, reaches officer rank 2 in term 2, and expects benefit rank 2 to
  // give the rank extra roll in the sample rules (minRank 2): 2 terms + 1 = 3 benefit rolls.
  // Criteria: CR-26.
  it('an officer’s benefit rank is the officer rank plus the enlisted rank at commission', () => {
    const result = buildMilitary(
      military(
        { 'term-1.commission.try': 'try', 'term-1.advancement-skill-0.table': 'officer', 'term-1.next': 'continue', 'term-2.skill-0.table': 'officer', 'term-2.advancement-skill-0.table': 'officer', 'term-2.next': 'leave' },
        { 'term-1.commission': 12, 'term-2.advancement': 12 },
      ),
    )
    expect(result.terms[1]?.rank).toBe(2)
    expect(result.terms[1]?.title).toBe('Captain')
    expect(result.benefitCount).toBe(2 * sampleRules.benefits.perTerm + 1)
  })

  // Asks the policy about a commission choice and expects "try".
  // Criteria: CR-27.
  it('Finish career tries for a commission', () => {
    const result = buildMilitary(military())
    expect(policyChoice({ kind: 'commission', key: 'term-1.commission.try' }, result, 5, SEED)).toBe('try')
  })
})

// Tests for the part 2b fields in the rules schema.
describe('part 2b rules fields', () => {
  // Parses the sample rules with a Draft table whose rolls skip 3 and expects the consecutive-rolls issue.
  it('rejects a Draft table with a gap in its rolls', () => {
    const result = RulesSchema.safeParse({ ...sampleRules, draft: [{ roll: 1, career: 'a' }, { roll: 2, career: 'b' }, { roll: 4, career: 'c' }] })
    expect(result.success).toBe(false)
  })

  // Parses DRAFT_RULES and COMMISSION_RULES and expects both to pass.
  it('accepts the Draft, fallback and commission fields', () => {
    expect(RulesSchema.safeParse(DRAFT_RULES).success).toBe(true)
    expect(RulesSchema.safeParse({ ...COMMISSION_RULES, qualification: { dmPerPreviousCareer: -1 } }).success).toBe(true)
  })
})
