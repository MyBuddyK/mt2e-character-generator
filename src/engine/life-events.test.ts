import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { finishCareer } from './policy'
import { RulesSchema, type LifeEventEntry, type Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, removeLastTerm, type CareerInput, type CareerResult, type Step } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'

// Unit tests for Life Events (docs/features/life-events.md). Each test builds the invented sample career,
// whose roll 7 event has a `life-event` effect, with term 1 forced to that event.

const SEED = 'life-events'
const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
/** Qualification and term 1 survival pass, the event is roll 7, and term 1 advancement rolls 2 (a fail). */
const ROLLS = { qualification: 12, 'term-1.survival': 12, 'term-1.event': 7, 'term-1.advancement': 2 }
/** Starts the debris-sweep assignment and picks Service skills for the term 1 skill roll. */
const START = {
  'start.career': 'sample-sanitation',
  'start.assignment': 'debris-sweep',
  'term-1.skill-0.table': 'serviceSkills',
}
/** The roll key of the Life Event from the term 1 event's first effect. */
const LIFE_KEY = 'term-1.event.effect-0.life-event'

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

/** Returns the sample rules with `table` as a 2D Life Events table, or with no Life Events table when undefined. */
function rulesWith(table: LifeEventEntry[] | undefined): Rules {
  const { lifeEvents: _unused, ...rest } = sampleRules
  return table === undefined ? rest : { ...rest, lifeEvents: { dice: 2, table } }
}

/** Returns START plus `choices` and ROLLS plus `rolls` as a CareerInput. */
function input(choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerInput {
  return { ...EMPTY_INPUT, choices: { ...START, ...choices }, rolls: { ...ROLLS, ...rolls } }
}

/** Builds the sample career with `rules` and the given extra choices and rolls. */
function build(rules: Rules = sampleRules, choices: Record<string, string> = {}, rolls: Record<string, number> = {}): CareerResult {
  return buildCareer(SEED, BASE, input(choices, rolls), { careers: [sampleCareer()], rules })
}

/** Returns the keys of term 1's steps. */
function stepKeys(result: CareerResult): string[] {
  return result.terms[0]?.steps.map((s) => s.key) ?? []
}

/** Returns the step with key `key` in any term, or throws when it is missing. */
function step(result: CareerResult, key: string): Step {
  const found = result.terms.flatMap((t) => t.steps).find((s) => s.key === key)
  if (!found) throw new Error(`no step ${key}`)
  return found
}

/** A three-row table: 6 gives Admin, 7 gives one ship share, 8 has a 1D sub-table. */
const TABLE: LifeEventEntry[] = [
  { roll: 6, summary: 'Six.', effects: [{ type: 'skill', options: ['Admin'] }] },
  { roll: 7, summary: 'Seven.', connection: true, effects: [{ type: 'ship-shares', count: 1 }] },
  {
    roll: 8,
    summary: 'Unusual.',
    subTable: [
      { roll: 1, summary: 'Sub one.', effects: [{ type: 'skill', options: ['Science'], level: 1 }] },
      { roll: 2, summary: 'Sub two.' },
    ],
  },
]

// Tests for the Life Event roll made by a `life-event` effect.
describe('life events', () => {
  // Builds term 1 with the sample rules and the Life Event dice at 7, and expects the Life Event step right
  // after the event step, with the sample entry as its result and two ship shares applied.
  // Criteria: LE-1, LE-7.
  it('a life-event effect adds a Life Event step after the event step', () => {
    const result = build(sampleRules, {}, { [LIFE_KEY]: 7 })
    const keys = stepKeys(result)
    expect(keys.indexOf(LIFE_KEY)).toBe(keys.indexOf('term-1.event') + 1)
    const life = step(result, LIFE_KEY)
    expect(life.label).toBe('Life Event')
    expect(life.result).toBe('Passes Go! Collects two ship shares.')
    expect(life.applied).toEqual(['2 ship shares'])
    expect(result.shipShares).toBe(2)
  })

  // Builds with TABLE and the Life Event dice at 6, then at 7, and expects Admin then a ship share and the
  // connection flag; the event step and earlier rolls are the same both times.
  // Criteria: LE-2.
  it('overriding the Life Event dice changes only the row used', () => {
    const six = build(rulesWith(TABLE), {}, { [LIFE_KEY]: 6 })
    const seven = build(rulesWith(TABLE), {}, { [LIFE_KEY]: 7 })
    expect(step(six, LIFE_KEY).result).toBe('Six.')
    expect(six.skills['Admin']).toBe(1)
    expect(step(seven, LIFE_KEY).result).toBe('Seven.')
    expect(step(seven, LIFE_KEY).connection).toBe(true)
    expect(seven.shipShares).toBe(1)
    expect(seven.skills['Admin']).toBeUndefined()
    expect(step(six, 'term-1.event')).toEqual(step(seven, 'term-1.event'))
    expect(step(six, 'term-1.survival')).toEqual(step(seven, 'term-1.survival'))
  })

  // Builds with TABLE and the Life Event dice at 2 and at 12, and expects the rows for 6 and 8 with the step
  // marked out of range.
  // Criteria: LE-3.
  it('a total outside the table uses the nearest row', () => {
    const low = step(build(rulesWith(TABLE), {}, { [LIFE_KEY]: 2 }), LIFE_KEY)
    expect(low.result).toBe('Six.')
    expect(low.outOfRange).toBe(true)
    const high = step(build(rulesWith(TABLE), {}, { [LIFE_KEY]: 12 }), LIFE_KEY)
    expect(high.result).toBe('Unusual.')
    expect(high.outOfRange).toBe(true)
  })

  // Builds with TABLE, the Life Event dice at 8 and the sub-table dice at 1, and expects a second step with
  // a 1D roll after the Life Event step, Science 1 applied, and Sub two for a sub-table roll of 2.
  // Criteria: LE-4.
  it('a row with a sub-table rolls 1D on it as a second step', () => {
    const result = build(rulesWith(TABLE), {}, { [LIFE_KEY]: 8, [`${LIFE_KEY}.sub`]: 1 })
    const keys = stepKeys(result)
    expect(keys.indexOf(`${LIFE_KEY}.sub`)).toBe(keys.indexOf(LIFE_KEY) + 1)
    const sub = step(result, `${LIFE_KEY}.sub`)
    expect(sub.label).toBe('Life Event: Unusual.')
    expect(sub.diceCount).toBe(1)
    expect(sub.result).toBe('Sub one.')
    expect(result.skills['Science']).toBe(1)
    const two = build(rulesWith(TABLE), {}, { [LIFE_KEY]: 8, [`${LIFE_KEY}.sub`]: 2 })
    expect(step(two, `${LIFE_KEY}.sub`).notes).toEqual(['Sub two.'])
  })

  // Builds with rules that have no Life Events table and expects no Life Event step and a note on the event.
  // Criteria: LE-5.
  it('with no Life Events table the effect is a note', () => {
    const result = build(rulesWith(undefined))
    expect(stepKeys(result)).not.toContain(LIFE_KEY)
    expect(step(result, 'term-1.event').notes).toContain('Roll on the Life Events table by hand: the rules have no Life Events table.')
    expect(result.shipShares).toBe(0)
  })

  // Builds with a one-row table whose entry has its own life-event effect, and expects one Life Event step
  // with a note to roll another by hand.
  // Criteria: LE-6.
  it('a life-event effect inside a Life Event is a note', () => {
    const result = build(rulesWith([{ roll: 7, summary: 'Again.', effects: [{ type: 'life-event' }] }]))
    const lifeSteps = stepKeys(result).filter((k) => k.includes('life-event'))
    expect(lifeSteps).toEqual([LIFE_KEY])
    expect(step(result, LIFE_KEY).notes).toContain('Roll another Life Event by hand. The app rolls one Life Event per entry.')
  })

  // Builds with a one-row table whose entry is a choice, and expects an event-choice pending named for the
  // Life Event; picking the ship share option applies it; Finish career picks one of the labels.
  // Criteria: LE-9.
  it('a choice on a Life Event entry asks the player, and Finish career picks one', () => {
    const rules = rulesWith([
      {
        roll: 7,
        summary: 'Pick one.',
        effects: [
          {
            type: 'choice',
            options: [
              { label: 'Ship share', effects: [{ type: 'ship-shares', count: 1 }] },
              { label: 'Admin', effects: [{ type: 'skill', options: ['Admin'] }] },
            ],
          },
        ],
      },
    ])
    const choiceKey = `${LIFE_KEY}.effect-0.choice`
    expect(build(rules).pending).toEqual({
      kind: 'event-choice',
      key: choiceKey,
      source: 'Life Event',
      summary: 'Pick one.',
      options: ['Ship share', 'Admin'],
    })
    expect(build(rules, { [choiceKey]: 'Ship share' }).shipShares).toBe(1)
    const data = { careers: [sampleCareer()], rules }
    const finished = finishCareer(SEED, BASE, input(), data)
    expect(['Ship share', 'Admin']).toContain(finished.choices[choiceKey])
  })

  // Plays term 1 with the sample career and continues into term 2 whose event is also roll 7, expects 4 ship
  // shares, removes term 2 and expects 2.
  // Criteria: LE-8, LE-10.
  it('ship shares add up, and removing a term removes its Life Event', () => {
    const data = { careers: [sampleCareer()], rules: sampleRules }
    const twoTerms = input(
      { 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' },
      { 'term-2.survival': 12, 'term-2.event': 7, 'term-2.advancement': 2 },
    )
    const built = buildCareer(SEED, BASE, twoTerms, data)
    expect(built.terms).toHaveLength(2)
    expect(built.shipShares).toBe(4)
    const removal = removeLastTerm(SEED, BASE, twoTerms, data, built)
    if (!removal) throw new Error('nothing removed')
    expect(buildCareer(SEED, BASE, removal.input, data).shipShares).toBe(2)
  })

  // Parses rules whose Life Events rows are 6 and 8, and rules whose sub-table rows are 1 and 3, and expects
  // both to fail RulesSchema; the sample rules and TABLE pass.
  // Criteria: LE-11.
  it('Life Events rows and sub-table rows must be consecutive', () => {
    const gap = { ...sampleRules, lifeEvents: { dice: 2, table: [{ roll: 6, summary: 'a' }, { roll: 8, summary: 'b' }] } }
    expect(RulesSchema.safeParse(gap).success).toBe(false)
    const subGap = {
      ...sampleRules,
      lifeEvents: { dice: 2, table: [{ roll: 7, summary: 'a', subTable: [{ roll: 1, summary: 'x' }, { roll: 3, summary: 'y' }] }] },
    }
    expect(RulesSchema.safeParse(subGap).success).toBe(false)
    expect(RulesSchema.safeParse(sampleRules).success).toBe(true)
    expect(RulesSchema.safeParse(rulesWith(TABLE)).success).toBe(true)
  })
})
