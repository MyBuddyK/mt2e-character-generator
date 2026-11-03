import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { buildCareer, EMPTY_INPUT, type CareerInput, type CareerResult, type Step } from './terms'
import type { Effect } from './effects'
import type { Rules } from './rules-schema'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'

// Tests added after the first Stryker run (npm run test:mutation) showed effect types, mustering-out
// branches and boundary values that no unit test checked. Each test builds the invented sample career.

const SEED = 'effects'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
/** Qualification and term 1 survival pass, term 1 advancement fails, and the event is roll 7 (replaced per test). */
const ROLLS = { qualification: 12, 'term-1.survival': 12, 'term-1.event': 7, 'term-1.advancement': 2 }
/** Starts the debris-sweep assignment and picks Service skills for the term 1 skill roll. */
const START = {
  'start.career': 'sample-sanitation',
  'start.assignment': 'debris-sweep',
  'term-1.skill-0.table': 'serviceSkills',
}

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

/** Returns the sample career with the event for roll 7 replaced by one with `effects`. */
function withEvent7(effects: Effect[]): CareerDefinition {
  const career = sampleCareer()
  return { ...career, events: career.events.map((e) => (e.roll === 7 ? { roll: 7, summary: 'Test event', effects } : e)) }
}

/** Builds `career` with START plus `choices`, ROLLS plus `rolls`, and `rules` (the sample rules by default). */
function build(
  career: CareerDefinition,
  choices: Record<string, string> = {},
  rolls: Record<string, number> = {},
  rules: Rules = sampleRules,
  base: Record<keyof typeof BASE, number> = BASE,
): CareerResult {
  const input: CareerInput = { ...EMPTY_INPUT, choices: { ...START, ...choices }, rolls: { ...ROLLS, ...rolls } }
  return buildCareer(SEED, base, input, { careers: [career], rules })
}

/** Returns the step of term 1 with key `term-1.<key>`, or throws when it is missing. */
function step(result: CareerResult, key: string): Step {
  const found = result.terms[0]?.steps.find((s) => s.key === `term-1.${key}`)
  if (!found) throw new Error(`no step term-1.${key}`)
  return found
}

// Tests for effect types that the other unit tests did not use.
describe('event effects', () => {
  // Gives the event extra-benefit with count 2, leaves after term 1, and expects 3 benefit rolls (1 for
  // the term plus 2) and the applied text; with no count it adds 1 and the text is singular.
  it('extra-benefit adds benefit rolls, 1 when no count is given', () => {
    const two = build(withEvent7([{ type: 'extra-benefit', count: 2 }]), { 'term-1.next': 'leave' })
    expect(two.benefitCount).toBe(3)
    expect(step(two, 'event').applied).toEqual(['2 extra benefit rolls'])
    const one = build(withEvent7([{ type: 'extra-benefit' }]), { 'term-1.next': 'leave' })
    expect(one.benefitCount).toBe(2)
    expect(step(one, 'event').applied).toEqual(['1 extra benefit roll'])
  })

  // Gives the event leave-career and expects the after-term choice forced to muster with the event's reason.
  it('leave-career forces mustering out after the term', () => {
    const result = build(withEvent7([{ type: 'leave-career' }]))
    expect(result.pending).toEqual({
      kind: 'next',
      key: 'term-1.next',
      forced: 'muster',
      reason: 'An event ends the career after this term.',
    })
    expect(step(result, 'event').applied).toEqual(['Leaves the career after this term'])
  })

  // Gives the event a mishap effect and expects an extra mishap step after the event that keeps the job:
  // the after-term choice stays open.
  it('a mishap effect rolls a mishap that keeps the job', () => {
    const result = build(withEvent7([{ type: 'mishap' }]))
    const extra = step(result, 'event.effect-0')
    expect(extra.label).toBe('Mishap (keeps the job)')
    expect(extra.result).not.toBe('')
    expect(result.pending).toMatchObject({ kind: 'next', forced: undefined })
  })

  // Gives a mishap row a mishap effect and fails survival, and expects one extra mishap and a note that
  // a second extra mishap is left to the player.
  it('a mishap effect inside a mishap rolls once and notes the rest', () => {
    const career = sampleCareer()
    const looping: CareerDefinition = {
      ...career,
      mishaps: career.mishaps.map((m) => ({ roll: m.roll, summary: `Mishap ${m.roll}`, effects: [{ type: 'mishap' }] })),
    }
    const result = build(looping, {}, { 'term-1.survival': 2 })
    const keys = result.terms[0]?.steps.map((s) => s.key) ?? []
    expect(keys.filter((k) => k.startsWith('term-1.mishap'))).toEqual(['term-1.mishap', 'term-1.mishap.effect-0'])
    expect(step(result, 'mishap.effect-0').label).toBe('Extra mishap')
    expect(step(result, 'mishap.effect-0').notes).toEqual([
      'Roll another mishap. The app rolls only one extra mishap per entry; apply this one by hand.',
    ])
  })

  // Gives the event characteristic END +2 and expects END changed by 2 and the applied text.
  it('characteristic changes the characteristic', () => {
    const result = build(withEvent7([{ type: 'characteristic', characteristic: 'END', change: 2 }]))
    expect(result.characteristicChanges.END).toBe(2)
    expect(step(result, 'event').applied).toEqual(['END +2'])
  })

  // Gives the event dm-next on advancement and expects the advancement total raised by the DM, the
  // qualification DM unchanged, and the advancement-only text; dm-next on qualification does the reverse.
  it('dm-next applies to the roll it names only', () => {
    const advancement = build(withEvent7([{ type: 'dm-next', roll: 'advancement', dm: 3 }]))
    const plain = build(withEvent7([]))
    expect((step(advancement, 'advancement').total ?? 0) - (step(plain, 'advancement').total ?? 0)).toBe(3)
    expect(advancement.qualificationDM).toBe(0)
    expect(step(advancement, 'event').applied).toEqual(['DM +3 on the next advancement roll'])

    const qualification = build(withEvent7([{ type: 'dm-next', roll: 'qualification', dm: -2 }]))
    expect(step(qualification, 'advancement').total).toBe(step(plain, 'advancement').total)
    expect(qualification.qualificationDM).toBe(-2)
    expect(step(qualification, 'event').applied).toEqual(['DM -2 on the next qualification roll (kept for a later career)'])
  })

  // Gives the event a wager with maxWager 1 after the character has earned 3 benefit rolls, and expects
  // the wager choice capped at 1.
  it('maxWager caps the wager below the rolls earned', () => {
    const career = withEvent7([
      { type: 'extra-benefit', count: 2 },
      { type: 'wager', skills: ['Vacc Suit'], target: 8, maxWager: 1 },
    ])
    expect(build(career).pending).toMatchObject({ kind: 'wager', max: 1 })
  })

  // Gives the event a reduce effect on STR, DEX and END by 2 and 1, picks STR then DEX, and expects
  // STR -2 and DEX -1 with END unchanged.
  it('reduce lowers each picked characteristic by its amount', () => {
    const career = withEvent7([{ type: 'reduce', characteristics: ['STR', 'DEX', 'END'], amounts: [2, 1] }])
    const first = build(career)
    expect(first.pending).toEqual({ kind: 'characteristic', key: 'term-1.event.effect-0.pick-0', options: ['STR', 'DEX', 'END'], amount: 2 })
    const done = build(career, { 'term-1.event.effect-0.pick-0': 'STR', 'term-1.event.effect-0.pick-1': 'DEX' })
    expect(done.characteristicChanges).toMatchObject({ STR: -2, DEX: -1, END: 0 })
  })
})

// Tests for skill table entries that name a characteristic.
describe('skill table characteristic entries', () => {
  // Rolls 1 on Personal development (STR) and expects STR +1 applied and no skill named STR.
  it('a characteristic entry on a skill roll raises the characteristic', () => {
    const result = build(sampleCareer(), { 'term-1.skill-0.table': 'personalDevelopment' }, { 'term-1.skill-0': 1 })
    expect(result.characteristicChanges.STR).toBe(1)
    expect(step(result, 'skill-0').applied).toEqual(['STR +1'])
    expect(result.skills).not.toHaveProperty('STR')
  })

  // Rolls 6 on Service skills (Steward) and expects the skill-table roll to use the sixth entry.
  it('a skill roll of 6 uses the last entry', () => {
    const result = build(sampleCareer(), {}, { 'term-1.skill-0': 6 })
    expect(step(result, 'skill-0').applied).toEqual(['Steward 1'])
  })
})

// Tests for the edges of checks and tables.
describe('boundaries', () => {
  // Sets EDU to the sample advancedEducationMinEDU (9) and expects Advanced education offered; at 8 it is not.
  it('advanced education is offered from the minimum EDU', () => {
    const options = (edu: number) => {
      const input: CareerInput = { ...EMPTY_INPUT, choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep' }, rolls: { qualification: 12 } }
      const pending = buildCareer(SEED, { ...BASE, EDU: edu }, input, { careers: [sampleCareer()], rules: sampleRules }).pending
      return pending?.kind === 'skill-table' ? pending.options : []
    }
    expect(options(sampleRules.advancedEducationMinEDU)).toContain('advancedEducation')
    expect(options(sampleRules.advancedEducationMinEDU - 1)).not.toContain('advancedEducation')
  })

  // With survival.failOnNatural 2, sets the survival dice to 3 and expects a pass with no natural-fail reason.
  it('failOnNatural fails only at or below its value', () => {
    const rules: Rules = { ...sampleRules, survival: { failOnNatural: 2 } }
    const result = build(sampleCareer(), {}, { 'term-1.survival': 3 }, rules, { ...BASE, DEX: 15 })
    expect(step(result, 'survival').result).toBe('pass')
    expect(step(result, 'survival').reasons).toEqual([])
  })

  // Rolls 1 on a table whose lowest row is 2 and expects the lowest row used and outOfRange set.
  it('a table total below the lowest row uses the lowest row', () => {
    const career = sampleCareer()
    const shifted: CareerDefinition = { ...career, mishaps: career.mishaps.map((m) => ({ ...m, roll: m.roll + 1 })) }
    const result = build(shifted, {}, { 'term-1.survival': 2, 'term-1.mishap': 1 })
    const mishap = step(result, 'mishap')
    expect(mishap.outOfRange).toBe(true)
    expect(mishap.result).toBe(career.mishaps[0]?.summary)
  })

  // With qualification ageDM { fromAge: 18, dm: -1 }, expects the first qualification roll (age 18) to
  // get DM -1 and the reason; with fromAge 19 it gets no DM.
  it('the qualification age DM applies from fromAge exactly', () => {
    const at = (fromAge: number) => {
      const career = sampleCareer()
      const aged: CareerDefinition = { ...career, qualification: { ...career.qualification, ageDM: { fromAge, dm: -1 } } }
      return build(aged).qualification
    }
    expect(at(sampleRules.startingAge)?.dm).toBe(-1)
    expect(at(sampleRules.startingAge)?.reasons).toEqual([`DM -1 for age ${sampleRules.startingAge} or more.`])
    expect(at(sampleRules.startingAge + 1)?.dm).toBe(0)
    expect(at(sampleRules.startingAge + 1)?.reasons).toEqual([])
  })

  // With totalPerIntEdu 1, rolls Mechanic on the term 1 skill roll (the first level gained) and
  // expects it kept when INT + EDU is 1 (a limit of 1) and lost when INT + EDU is 0 (a limit of 0).
  it('the total skill limit allows exactly the limit', () => {
    const rules: Rules = { ...sampleRules, skillLimits: { totalPerIntEdu: 1 } }
    // Basic training gives level 0 skills only, so the skill roll is the first level counted.
    const result = build(sampleCareer(), {}, { 'term-1.skill-0': 3 }, rules, { ...BASE, INT: 1, EDU: 0 })
    expect(result.skills['Mechanic']).toBe(1)
    const over = build(sampleCareer(), {}, { 'term-1.skill-0': 3 }, rules, { ...BASE, INT: 0, EDU: 0 })
    expect(over.skills['Mechanic']).toBe(0)
  })
})

// Tests for cash and benefit rolls in mustering out.
describe('mustering out details', () => {
  /** Sample rules with three benefit rolls per term and no rank DMs. */
  const three: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, perTerm: 3, rankBenefitDM: [], rankExtra: [] } }

  // Takes cash, benefit, cash with dice 1, 3 and 6, and expects cash only from the cash rolls, the
  // benefit only from the benefit roll, the step results, and the cash limit of 2 reached.
  it('cash rolls give cash and benefit rolls give benefits', () => {
    const table = sampleCareer().musteringOut
    const row = (n: number) => table.find((r) => r.roll === n)
    const result = build(
      sampleCareer(),
      { 'term-1.next': 'leave', 'benefit-0': 'cash', 'benefit-1': 'benefit', 'benefit-2': 'cash' },
      { 'benefit-0': 1, 'benefit-1': 3, 'benefit-2': 6 },
      three,
    )
    expect(result.benefits.map((b) => [b.table, b.cash, b.benefit])).toEqual([
      ['cash', row(1)?.cash, undefined],
      ['benefit', 0, row(3)?.benefit],
      ['cash', row(6)?.cash, undefined],
    ])
    expect(result.benefits.map((b) => b.step.result)).toEqual([`Cr${row(1)?.cash}`, row(3)?.benefit, `Cr${row(6)?.cash}`])
    expect(result.benefits.map((b) => b.step.label)).toEqual(['Cash roll', 'Benefit roll', 'Cash roll'])
    expect(result.cash).toBe((row(1)?.cash ?? 0) + (row(6)?.cash ?? 0))
  })

  // Takes two benefit rolls, then asks for the third, and expects cash still allowed: benefit rolls do
  // not count toward the cash roll limit.
  it('benefit rolls do not count toward the cash limit', () => {
    const result = build(sampleCareer(), { 'term-1.next': 'leave', 'benefit-0': 'benefit', 'benefit-1': 'benefit' }, {}, {
      ...three,
      benefits: { ...three.benefits, cashRollLimit: 1 },
    })
    expect(result.pending).toEqual({ kind: 'benefit', key: 'benefit-2', index: 2, count: 3, cashAllowed: true })
  })

  // With a +1 rank DM and a +2 event benefit DM, takes cash then benefit and expects the reasons on each
  // roll to name only the DMs that apply to it.
  it('each benefit roll lists the DMs that apply to it', () => {
    const rules: Rules = { ...three, benefits: { ...three.benefits, perTerm: 2, rankBenefitDM: [{ minRank: 0, dm: 1 }] } }
    const result = build(
      withEvent7([{ type: 'benefit-dm', dm: 2 }]),
      { 'term-1.next': 'leave', 'benefit-0': 'cash', 'benefit-1': 'benefit' },
      { 'benefit-0': 1, 'benefit-1': 1 },
      rules,
    )
    expect(result.benefits.map((b) => b.step.reasons)).toEqual([
      ['DM +1 from rank 0.'],
      ['DM +1 from rank 0.', 'DM +2 from an event.'],
    ])
    expect(result.benefits.map((b) => b.step.total)).toEqual([2, 4])
  })

  // With cashSkillDM Vacc Suit +1 (Vacc Suit 0 from basic training), takes cash then benefit and expects
  // the skill reason on the cash roll only.
  it('the cash skill DM reason is on cash rolls only', () => {
    const rules: Rules = { ...three, benefits: { ...three.benefits, perTerm: 2, cashSkillDM: { skill: 'Vacc Suit', dm: 1 } } }
    const result = build(sampleCareer(), { 'term-1.next': 'leave', 'benefit-0': 'cash', 'benefit-1': 'benefit' }, { 'benefit-0': 1, 'benefit-1': 1 }, rules)
    expect(result.benefits.map((b) => b.step.reasons)).toEqual([['DM +1 from Vacc Suit.'], []])
  })

  // With rankExtra at minRank 0 (+1) and minRank 1 (+3), leaves at rank 1 and expects the highest
  // matching entry used: 1 term roll plus 3.
  it('the highest rank extra that applies is used', () => {
    const rules: Rules = { ...three, benefits: { ...three.benefits, perTerm: 1, rankExtra: [{ minRank: 1, extra: 3 }, { minRank: 0, extra: 1 }] } }
    const result = build(
      sampleCareer(),
      { 'term-1.next': 'leave', 'term-1.advancement-skill-0.table': 'serviceSkills' },
      { 'term-1.advancement': 12 },
      rules,
    )
    expect(result.rank).toBe(1)
    expect(result.benefitCount).toBe(4)
  })
})
