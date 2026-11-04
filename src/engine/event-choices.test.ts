import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import type { Effect } from './effects'
import { finishCareer } from './policy'
import type { Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, pruneInput, type CareerInput, type CareerResult, type Step } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'

// Unit tests for event and mishap choices and for forward DMs (docs/features/event-choices.md). Each
// test builds the invented sample career with its roll 7 event, or every mishap, replaced.

const SEED = 'choices'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
/** Qualification and term 1 survival pass, the event is roll 7, and term 1 advancement rolls 2 (DM +0, a fail). */
const ROLLS = { qualification: 12, 'term-1.survival': 12, 'term-1.event': 7, 'term-1.advancement': 2 }
/** Starts the debris-sweep assignment and picks Service skills for the term 1 skill roll. */
const START = {
  'start.career': 'sample-sanitation',
  'start.assignment': 'debris-sweep',
  'term-1.skill-0.table': 'serviceSkills',
}
/** The choice key of the first effect on the term 1 event. */
const EVENT_CHOICE = 'term-1.event.effect-0.choice'

/** A choice between Admin 1 and DM +4 on the next advancement roll. */
const SKILL_OR_DM: Effect = {
  type: 'choice',
  options: [
    { label: 'Admin 1', effects: [{ type: 'skill', options: ['Admin'], level: 1 }] },
    { label: 'DM +4 to the next advancement roll', effects: [{ type: 'dm-next', roll: 'advancement', dm: 4 }] },
  ],
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
function build(career: CareerDefinition, choices: Record<string, string> = {}, rolls: Record<string, number> = {}, rules: Rules = sampleRules): CareerResult {
  return buildCareer(SEED, BASE, input(choices, rolls), { careers: [career], rules })
}

/** Returns START plus `choices` and ROLLS plus `rolls` as a CareerInput. */
function input(choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerInput {
  return { ...EMPTY_INPUT, choices: { ...START, ...choices }, rolls: { ...ROLLS, ...rolls } }
}

/** Returns the step with key `key` in any term, or throws when it is missing. */
function step(result: CareerResult, key: string): Step {
  const found = result.terms.flatMap((t) => t.steps).find((s) => s.key === key)
  if (!found) throw new Error(`no step ${key}`)
  return found
}

// Tests for the choice effect on events.
describe('event choices', () => {
  // Gives the event a choice between Admin 1 and a DM, and expects the build to stop with an
  // event-choice pending that names the step, the summary and both labels, before the advancement roll.
  // Criteria: EC-2.
  it('a choice on an event asks the player which option to take', () => {
    const result = build(withEvent7([SKILL_OR_DM]))
    expect(result.pending).toEqual({
      kind: 'event-choice',
      key: EVENT_CHOICE,
      source: 'Event',
      summary: 'Test event',
      options: ['Admin 1', 'DM +4 to the next advancement roll'],
    })
    expect(result.terms[0]?.steps.some((s) => s.key === 'term-1.advancement')).toBe(false)
  })

  // Picks Admin 1 and expects Admin 1 gained, no DM on advancement, and the step to say which option
  // was chosen; picks the DM option and expects advancement DM +4 with its reason and no Admin.
  // Criteria: EC-3, EC-5.
  it('picking an option applies only that option', () => {
    const career = withEvent7([SKILL_OR_DM])
    const skill = build(career, { [EVENT_CHOICE]: 'Admin 1' })
    expect(skill.skills['Admin']).toBe(1)
    expect(step(skill, 'term-1.event').applied).toEqual(['Chose: Admin 1', 'Admin 1'])
    expect(step(skill, 'term-1.advancement').dm).toBe(0)
    expect(skill.usedKeys.has(EVENT_CHOICE)).toBe(true)

    const dm = build(career, { [EVENT_CHOICE]: 'DM +4 to the next advancement roll' })
    expect(dm.skills).not.toHaveProperty('Admin')
    expect(step(dm, 'term-1.event').applied).toEqual([
      'Chose: DM +4 to the next advancement roll',
      'DM +4 on the next advancement roll',
    ])
    expect(step(dm, 'term-1.advancement').dm).toBe(4)
    expect(step(dm, 'term-1.advancement').total).toBe(6)
    expect(step(dm, 'term-1.advancement').reasons).toContain('DM +4 from an event.')
  })

  // Saves a label that is not one of the options and expects the choice asked for again.
  // Criteria: EC-2.
  it('a saved label that is not an option asks again', () => {
    const result = build(withEvent7([SKILL_OR_DM]), { [EVENT_CHOICE]: 'Pilot 1' })
    expect(result.pending).toMatchObject({ kind: 'event-choice', key: EVENT_CHOICE })
  })
})

// Tests for the choice effect on mishaps, with stay-in-career and keep-benefit inside an option.
describe('mishap choices', () => {
  /** Sample rules where a term that ends in a mishap gives no benefit roll. */
  const losesTerm: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, mishapLosesTerm: true } }
  /** The sample career with every mishap replaced by a choice of staying, keeping the benefit roll, or neither. */
  const career: CareerDefinition = {
    ...sampleCareer(),
    mishaps: sampleCareer().mishaps.map((m) => ({
      roll: m.roll,
      summary: `Mishap ${m.roll}`,
      effects: [
        {
          type: 'choice',
          options: [
            { label: 'Stay', effects: [{ type: 'stay-in-career' }] },
            { label: 'Leave with the benefit roll', effects: [{ type: 'keep-benefit' }] },
            { label: 'Walk away' },
          ],
        },
      ],
    })),
  }
  /** Fails term 1 survival and picks `label` for the mishap choice. */
  const pick = (label: string | undefined) =>
    build(career, label === undefined ? {} : { 'term-1.mishap.effect-0.choice': label }, { 'term-1.survival': 2 }, losesTerm)

  // Fails survival and expects the mishap choice pending with the mishap's summary.
  // Criteria: EC-2, EC-4.
  it('a choice on a mishap asks the player which option to take', () => {
    expect(pick(undefined).pending).toMatchObject({ kind: 'event-choice', key: 'term-1.mishap.effect-0.choice', source: 'Mishap' })
  })

  // Picks Stay and expects the after-term choice open (not forced to muster), and the term's benefit
  // roll kept with no lost-roll reason, the same as a stay-in-career listed outside a choice.
  // Criteria: EC-4.
  it('an option with stay-in-career keeps the character in the career and the benefit roll', () => {
    const result = pick('Stay')
    expect(result.pending).toEqual({ kind: 'next', key: 'term-1.next', forced: undefined, reason: undefined })
    expect(result.terms[0]?.endReason).toBeUndefined()
    expect(result.lostBenefitTerms).toBe(0)
    expect(step(result, 'term-1.mishap').reasons).toEqual([])
  })

  // Gives every mishap leave-career followed by a choice whose first option is stay-in-career, picks
  // that option, and expects mustering out still forced by the leave-career effect.
  // Criteria: EC-4.
  it('a stay-in-career option does not undo a leave-career effect on the same mishap', () => {
    const leaving: CareerDefinition = {
      ...career,
      mishaps: career.mishaps.map((m) => ({ ...m, effects: [{ type: 'leave-career' }, ...(m.effects ?? [])] })),
    }
    const result = build(leaving, { 'term-1.mishap.effect-1.choice': 'Stay' }, { 'term-1.survival': 2 }, losesTerm)
    expect(result.pending).toMatchObject({ kind: 'next', forced: 'muster', reason: 'An event ends the career after this term.' })
  })

  // Picks Leave with the benefit roll and expects mustering out forced, no lost benefit roll, and no
  // lost-roll reason on the step; picks Walk away and expects mustering out forced with the roll lost.
  // Criteria: EC-4.
  it('an option with keep-benefit gives back the benefit roll', () => {
    const kept = pick('Leave with the benefit roll')
    expect(kept.pending).toMatchObject({ kind: 'next', forced: 'muster' })
    expect(kept.lostBenefitTerms).toBe(0)
    expect(step(kept, 'term-1.mishap').reasons).toEqual([])

    const walked = pick('Walk away')
    expect(walked.pending).toMatchObject({ kind: 'next', forced: 'muster' })
    expect(walked.lostBenefitTerms).toBe(1)
    expect(step(walked, 'term-1.mishap').reasons).toEqual(['This term gives no benefit roll because it ended in a mishap.'])
  })
})

// Tests for forward DMs: dm-next on survival (applied by the engine) and dm-later (applied by the player).
describe('forward DMs', () => {
  /** Continues into term 2 with Service skills and passes term 2 survival with dice 12. */
  const TERM_2 = { 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' }

  // Gives the event dm-next survival -2, continues to term 2, and expects DM -2 and its reason on the
  // term 2 survival roll only, not on term 1 advancement.
  // Criteria: EC-5.
  it('dm-next on survival applies to the next survival roll', () => {
    const result = build(withEvent7([{ type: 'dm-next', roll: 'survival', dm: -2 }]), TERM_2, { 'term-2.survival': 12 })
    expect(step(result, 'term-1.event').applied).toEqual(['DM -2 on the next survival roll'])
    expect(step(result, 'term-1.advancement').dm).toBe(0)
    expect(step(result, 'term-2.survival').dm).toBe(-2)
    expect(step(result, 'term-2.survival').reasons).toContain('DM -2 from an event.')
  })

  // Gives the event dm-next survival +3 and takes anagathics in term 2, and expects the DM on the
  // first term 2 survival roll only, not on the second (anagathics) survival roll.
  // Criteria: EC-5.
  it('dm-next on survival goes on the first survival roll of a term on anagathics', () => {
    const rules: Rules = { ...sampleRules, anagathics: { characteristic: 'SOC', target: 2, costDice: 1, costPerDie: 1 } }
    const result = build(
      withEvent7([{ type: 'dm-next', roll: 'survival', dm: 3 }]),
      { ...TERM_2, 'term-2.anagathics': 'take' },
      { 'term-2.anagathics': 12, 'term-2.survival': 12, 'term-2.survival-2': 12 },
      rules,
    )
    expect(step(result, 'term-2.survival').dm).toBe(3)
    expect(step(result, 'term-2.survival-2').dm).toBe(0)
  })

  // Gives the event dm-next advancement +4 and allows a commission (SOC 8+), tries for it and fails, and
  // expects the DM and its reason on the commission roll and no event DM on the advancement roll after.
  // Criteria: EC-5.
  it('an advancement DM used by a failed commission roll does not go on advancement too', () => {
    const rules: Rules = { ...sampleRules, commission: { anyTermFromSOC: 9, dmPerLaterTerm: -1 } }
    const career: CareerDefinition = { ...withEvent7([{ type: 'dm-next', roll: 'advancement', dm: 4 }]), commission: { characteristic: 'SOC', target: 8 } }
    const result = build(career, { 'term-1.commission.try': 'try' }, { 'term-1.commission': 2 }, rules)
    expect(step(result, 'term-1.commission').dm).toBe(4)
    expect(step(result, 'term-1.commission').reasons).toContain('DM +4 from an event.')
    expect(step(result, 'term-1.commission').result).toBe('fail')
    expect(step(result, 'term-1.advancement').dm).toBe(0)
    expect(step(result, 'term-1.advancement').reasons).not.toContain('DM +4 from an event.')
  })

  // Gives the event dm-next survival +2, leaves after term 1, and expects the DM reported as unused
  // in the result; with no DM both unused values are 0.
  // Criteria: EC-8.
  it('a dm-next DM not used when the career ends is reported as unused', () => {
    const result = build(withEvent7([{ type: 'dm-next', roll: 'survival', dm: 2 }]), { 'term-1.next': 'leave', 'benefit-0': 'benefit' })
    expect(result.finished).toBe(true)
    expect(result.unusedNextDMs).toEqual({ advancement: 0, survival: 2 })
    expect(build(withEvent7([])).unusedNextDMs).toEqual({ advancement: 0, survival: 0 })
  })

  // Gives the event dm-later +4 on advancement rolls, and expects it held on the event step, not
  // applied, with term 1 advancement as its only target; then picks term 1 advancement and expects DM
  // +4 on that roll with the reason, and the DM marked as applied.
  // Criteria: EC-6.
  it('dm-later waits for the player to pick the roll', () => {
    const career = withEvent7([{ type: 'dm-later', dm: 4, rolls: ['advancement'] }])
    const held = build(career)
    const later = step(held, 'term-1.event').later?.[0]
    expect(later).toEqual({
      key: 'term-1.event.effect-0.apply',
      dm: 4,
      rolls: ['advancement'],
      source: 'Term 1 Event',
      appliedTo: undefined,
      targets: [{ key: 'term-1.advancement', label: 'Term 1 Advancement' }],
    })
    expect(step(held, 'term-1.event').applied).toEqual(['DM +4 to hold for one later advancement roll (pick the roll)'])
    expect(step(held, 'term-1.advancement').dm).toBe(0)

    const applied = build(career, { 'term-1.event.effect-0.apply': 'term-1.advancement' })
    expect(step(applied, 'term-1.advancement').dm).toBe(4)
    expect(step(applied, 'term-1.advancement').reasons).toContain('DM +4 from Term 1 Event, applied by the player.')
    expect(applied.laterDMs[0]?.appliedTo).toBe('term-1.advancement')
  })

  // Gives the event dm-later with no roll kinds, leaves after term 1 and takes one benefit, and expects
  // the advancement roll and the benefit roll as targets; applies it to the benefit roll and expects
  // DM +4 on it.
  // Criteria: EC-6.
  it('dm-later with no roll kinds can go on any later roll, including mustering out', () => {
    const career = withEvent7([{ type: 'dm-later', dm: 4 }])
    const choices = { 'term-1.next': 'leave', 'benefit-0': 'benefit' }
    const result = build(career, choices)
    expect(result.laterDMs[0]?.targets).toEqual([
      { key: 'term-1.advancement', label: 'Term 1 Advancement' },
      { key: 'benefit-0', label: 'Mustering out Benefit roll 1' },
    ])
    const applied = build(career, { ...choices, 'term-1.event.effect-0.apply': 'benefit-0' }, { 'benefit-0': 1 })
    expect(applied.benefits[0]?.step.total).toBe(5)
    expect(step(applied, 'term-1.advancement').dm).toBe(0)
  })

  // Saves a dm-later roll pick that names a survival roll (not an allowed kind) and one that names a
  // roll not built yet, and expects neither applied and both removed by pruneInput.
  // Criteria: EC-7.
  it('a dm-later pick for a roll that is not offered is not applied and is pruned', () => {
    const career = withEvent7([{ type: 'dm-later', dm: 4, rolls: ['advancement'] }])
    for (const target of ['term-1.survival', 'term-2.advancement']) {
      const saved = input({ 'term-1.event.effect-0.apply': target })
      const result = buildCareer(SEED, BASE, saved, { careers: [career], rules: sampleRules })
      expect(result.laterDMs[0]?.appliedTo).toBeUndefined()
      expect(pruneInput(saved, result.usedKeys).removed).toContain('term-1.event.effect-0.apply')
    }
  })
})

// Tests for Finish career with event choices and forward DMs.
describe('Finish career with choices', () => {
  // Runs Finish career twice on a career whose event offers a choice and a dm-later DM, and expects
  // the same option picked both times, the option to be one of the labels, and the DM left unapplied.
  // Criteria: EC-8.
  it('Finish career picks an option from the seed and leaves dm-later unapplied', () => {
    const career = withEvent7([SKILL_OR_DM, { type: 'dm-later', dm: 2 }])
    const data = { careers: [career], rules: sampleRules }
    const start = { ...EMPTY_INPUT, choices: { ...START }, rolls: { ...ROLLS } }
    const first = finishCareer(SEED, BASE, start, data)
    const second = finishCareer(SEED, BASE, start, data)
    expect(first.choices[EVENT_CHOICE]).toBe(second.choices[EVENT_CHOICE])
    expect(['Admin 1', 'DM +4 to the next advancement roll']).toContain(first.choices[EVENT_CHOICE])
    expect(first.choices).not.toHaveProperty('term-1.event.effect-1.apply')
    const result = buildCareer(SEED, BASE, first, data)
    expect(result.finished).toBe(true)
    // Later terms can roll event 7 again, so there is at least one DM, and none is applied.
    expect(result.laterDMs.length).toBeGreaterThan(0)
    expect(result.laterDMs.every((d) => d.appliedTo === undefined)).toBe(true)
  })
})
