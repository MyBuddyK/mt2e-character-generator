import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { parseCareerPack, selectRules } from './career-pack'
import { RulesSchema, type Rules } from './rules-schema'
import { diceFor } from './dice'
import { generateRest, policyChoice } from './policy'
import { buildCareer, EMPTY_INPUT, pruneInput, type CareerInput, type CareerResult } from './terms'
import { sampleRules } from '../data/rules'
import { readSavedCharacter, writeSavedCharacter } from '../storage/characters'
import sampleCareerJson from '../data/careers/sample-sanitation.json'
import validPack from '../../e2e/fixtures/valid-pack.json'

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

const BASE = { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }
const SEED = 'terms'

/** Returns an input that starts the sample career in the debris-sweep assignment, plus `choices`, `rolls` and `outcomes`. */
function started(
  choices: Record<string, string> = {},
  rolls: Record<string, number> = {},
  outcomes: CareerInput['outcomes'] = {},
): CareerInput {
  return {
    ...EMPTY_INPUT,
    choices: { 'start.career': 'sample-sanitation', 'start.assignment': 'debris-sweep', ...choices },
    rolls,
    outcomes,
  }
}

/** Builds the sample career from `input` with the sample rules, or with `rules` and `career` when given. */
function build(input: CareerInput, rules: Rules = sampleRules, career: CareerDefinition = sampleCareer()): CareerResult {
  return buildCareer(SEED, BASE, input, { careers: [career], rules })
}

/** Returns a step of a term by its key, or throws when it is missing. */
function step(result: CareerResult, term: number, key: string) {
  const found = result.terms[term - 1]?.steps.find((s) => s.key === `term-${term}.${key}`)
  if (!found) throw new Error(`no step term-${term}.${key}`)
  return found
}

/** Rolls that make qualification pass and term 1 survive, with the first skill roll on the service skills table. */
const PASSING = { qualification: 12, 'term-1.survival': 12 }
const SERVICE = { 'term-1.skill-0.table': 'serviceSkills' }

// Tests for the start of a career in buildCareer.
describe('buildCareer start', () => {
  // Builds with no choices and expects the start choice to be pending.
  it('asks for a career first', () => {
    expect(build(EMPTY_INPUT).pending).toEqual({ kind: 'start', failedQualification: false })
  })

  // Saves a career id that isn't loaded and expects a problem naming it and the start choice pending.
  it('reports a saved career that is not loaded', () => {
    const result = build({ ...EMPTY_INPUT, choices: { 'start.career': 'gone', 'start.assignment': 'x' } })
    expect(result.problems).toEqual(['The saved career "gone" isn\'t loaded.'])
    expect(result.pending?.kind).toBe('start')
  })

  // Overrides the qualification dice to 2 and expects a failed qualification with the start choice pending.
  it('stops after a failed qualification', () => {
    const result = build(started({}, { qualification: 2 }))
    expect(result.qualification?.passed).toEqual({ rolled: false })
    expect(result.pending).toEqual({ kind: 'start', failedQualification: true })
    expect(result.terms).toEqual([])
  })

  // Builds the same input twice and expects the same first-term steps.
  it('gives the same first term for the same seed and input', () => {
    const input = started({ ...SERVICE, 'term-1.next': 'continue' })
    expect(build(input).terms[0]).toEqual(build(input).terms[0])
  })
})

// Tests for the steps of a term in buildCareer.
describe('buildCareer terms', () => {
  // Passes qualification and expects term 1 to add every service skill at the basic training level, and rank 0.
  it('applies basic training and rank 0 in the first term', () => {
    const result = build(started(SERVICE, PASSING))
    for (const skill of sampleCareer().skillTables.serviceSkills) expect(result.skills).toHaveProperty(skill)
    expect(result.skills['Vacc Suit']).toBe(sampleRules.basicTraining.level)
    expect(result.terms[0]?.rank).toBe(0)
    expect(result.terms[0]?.title).toBe('Sweeper')
  })

  // Builds without a table choice and expects the skill-table choice pending, with advanced education
  // left out because EDU 7 is below the sample minimum.
  it('asks which skill table to roll on and leaves out tables the character cannot use', () => {
    const result = build(started({}, PASSING))
    expect(result.pending).toEqual({
      kind: 'skill-table',
      key: 'term-1.skill-0.table',
      options: ['personalDevelopment', 'serviceSkills', 'assignment'],
    })
  })

  // Overrides survival to a failing total and expects a mishap instead of an event, no advancement
  // roll, and a forced end; then removes the override and expects the event and advancement back.
  it('a failed survival gives a mishap and ends the career; resetting brings back the event', () => {
    const failed = build(started(SERVICE, { qualification: 12, 'term-1.survival': 2 }))
    const keys = failed.terms[0]?.steps.map((s) => s.key) ?? []
    expect(keys).toContain('term-1.mishap')
    expect(keys).not.toContain('term-1.event')
    expect(keys).not.toContain('term-1.advancement')
    expect(failed.pending).toMatchObject({ kind: 'next', forced: true })

    const reset = build(started(SERVICE, PASSING))
    const resetKeys = reset.terms[0]?.steps.map((s) => s.key) ?? []
    expect(resetKeys).toContain('term-1.event')
    expect(resetKeys).toContain('term-1.advancement')
  })

  // Rules the survival check a fail with the outcome override and expects the same mishap path.
  it('a pass or fail override replaces the dice result', () => {
    const result = build(started(SERVICE, PASSING, { 'term-1.survival': 'fail' }))
    expect(step(result, 1, 'survival').passed).toEqual({ rolled: true, override: false })
    expect(result.terms[0]?.steps.map((s) => s.key)).toContain('term-1.mishap')
  })

  // Builds two terms, then overrides the term 1 advancement dice both ways, and expects the term 2
  // skill roll to be the same each time.
  it('overriding a roll in term 1 does not change the skill roll in term 2', () => {
    const choices = { ...SERVICE, 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' }
    const rolls = { ...PASSING, 'term-2.survival': 12 }
    const a = build(started(choices, { ...rolls, 'term-1.advancement': 2 }))
    const b = build(started(choices, { ...rolls, 'term-1.advancement': 3 }))
    expect(step(a, 2, 'skill-0').dice).toEqual(step(b, 2, 'skill-0').dice)
  })

  // Overrides the event to 6 (a skill effect with two options), and expects the skill option
  // pending; picking Engineer adds Engineer 1.
  it('an event with a skill effect adds the skill, asking first when there is a choice', () => {
    const rolls = { ...PASSING, 'term-1.event': 6 }
    expect(build(started(SERVICE, rolls)).pending).toEqual({
      kind: 'skill-option',
      key: 'term-1.event.effect-0.skill',
      options: ['Mechanic', 'Engineer'],
    })
    const result = build(started({ ...SERVICE, 'term-1.event.effect-0.skill': 'Engineer' }, rolls))
    expect(result.skills['Engineer']).toBe(1)
  })

  // Overrides the event to 9 (no effects, connection: true) and expects its summary as a note, the
  // connection marker, and the character's skills unchanged by it.
  it('an event without effects is a note, and a connection event is listed', () => {
    const plain = build(started(SERVICE, { ...PASSING, 'term-1.event': 7 }))
    const result = build(started(SERVICE, { ...PASSING, 'term-1.event': 9 }))
    const event = step(result, 1, 'event')
    expect(event.notes).toEqual([event.result])
    expect(event.connection).toBe(true)
    expect(result.connections).toEqual([{ term: 1, label: 'Event', summary: event.result }])
    expect(plain.connections).toEqual([])
  })

  // Passes advancement in term 1 and expects rank 1 with its skill effect (Pilot 1).
  it('reaching a rank applies its effects', () => {
    const result = build(started({ ...SERVICE, 'term-1.advancement-skill-0.table': 'serviceSkills' }, { ...PASSING, 'term-1.advancement': 12 }))
    expect(result.rank).toBe(1)
    expect(result.skills['Pilot']).toBeGreaterThanOrEqual(1)
    expect(step(result, 1, 'rank-1').applied).toContain('Pilot 1')
  })

  // Removes the effects from the rank 1 entry and expects its bonus shown as a note instead.
  it('a rank bonus without effects is shown as a note', () => {
    const career = sampleCareer()
    const assignment = career.assignments[0]
    const rank1 = assignment?.ranks.find((r) => r.rank === 1)
    if (!assignment || !rank1) throw new Error('fixture')
    const plain: CareerDefinition = {
      ...career,
      assignments: [{ ...assignment, ranks: assignment.ranks.map((r) => (r === rank1 ? { rank: 1, bonus: 'Pilot 1' } : r)) }],
    }
    const result = build(
      started({ ...SERVICE, 'term-1.advancement-skill-0.table': 'serviceSkills' }, { ...PASSING, 'term-1.advancement': 12 }),
      sampleRules,
      plain,
    )
    expect(step(result, 1, 'rank-1').notes).toEqual(['Pilot 1'])
  })

  // Continues into term 2 and expects its age range to start one term length after term 1's.
  it('each term adds the term length to the age', () => {
    const result = build(started({ ...SERVICE, 'term-1.next': 'continue' }, PASSING))
    expect(result.terms.map((t) => t.ageStart)).toEqual([
      sampleRules.startingAge,
      sampleRules.startingAge + sampleRules.termLength,
    ])
  })

  // Generates a career that survives every term, and expects an aging step only from the sample's
  // fromTerm onwards.
  it('rolls aging only from the term set in rules', () => {
    const rolls: Record<string, number> = { qualification: 12 }
    for (let n = 1; n <= 5; n += 1) rolls[`term-${n}.survival`] = 12
    const input = generateRest(SEED, BASE, started({}, rolls), { careers: [sampleCareer()], rules: sampleRules })
    const result = build(input)
    const aging = result.terms.map((t) => t.steps.some((s) => s.key === `term-${t.number}.aging`))
    expect(aging).toEqual(result.terms.map((t) => t.number >= sampleRules.aging.fromTerm))
  })
})

// Tests for mustering out in buildCareer.
describe('buildCareer mustering out', () => {
  // Leaves after one term at rank 0 and expects one benefit roll (sample perTerm 1) pending with cash allowed.
  it('gives the number of benefit rolls set in rules', () => {
    const result = build(started({ ...SERVICE, 'term-1.next': 'leave', 'benefit-0': 'benefit' }, { ...PASSING, 'term-1.advancement': 2 }))
    expect(result.finished).toBe(true)
    expect(result.benefits).toHaveLength(sampleRules.benefits.perTerm)
  })

  // Uses rules with three benefit rolls per term and a cash limit of 1, takes cash on the first, and
  // expects cash not allowed on the second.
  it('stops offering cash once the cash roll limit is reached', () => {
    const rules: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, perTerm: 3, cashRollLimit: 1 } }
    const result = build(started({ ...SERVICE, 'term-1.next': 'leave', 'benefit-0': 'cash' }, { ...PASSING, 'term-1.advancement': 2 }), rules)
    expect(result.pending).toEqual({ kind: 'benefit', key: 'benefit-1', index: 1, cashAllowed: false })
  })

  // Takes the event with a +1 benefit DM (event roll 8), uses rules with a +2 rank DM on benefit
  // rolls, sets the benefit die to 6 for a total of 9, and expects the row for roll 7 with
  // outOfRange set.
  it('a benefit total above the table uses the highest row and says so', () => {
    const rules: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, rankBenefitDM: [{ minRank: 0, dm: 2 }] } }
    const result = build(
      started({ ...SERVICE, 'term-1.next': 'leave', 'benefit-0': 'benefit' }, { ...PASSING, 'term-1.advancement': 2, 'term-1.event': 8, 'benefit-0': 6 }),
      rules,
    )
    const benefit = result.benefits[0]
    expect(benefit?.step.total).toBe(9)
    expect(benefit?.step.outOfRange).toBe(true)
    expect(benefit?.benefit).toBe(sampleCareer().musteringOut.find((r) => r.roll === 7)?.benefit)
  })
})

// Tests for the Generate the rest policy in policy.ts.
describe('generateRest', () => {
  // Generates from a started career and expects a finished character with no pending choice, at most
  // termLimit terms, and cash on the first benefit roll.
  it('finishes the character within the term limit', () => {
    const input = generateRest(SEED, BASE, started(), { careers: [sampleCareer()], rules: sampleRules })
    const result = build(input)
    expect(result.finished).toBe(true)
    expect(result.pending).toBeUndefined()
    expect(result.terms.length).toBeLessThanOrEqual(sampleRules.termLimit)
    expect(result.benefits[0]?.table).toBe('cash')
  })

  // Generates with no career chosen and expects the input unchanged.
  it('does not pick a career', () => {
    expect(generateRest(SEED, BASE, EMPTY_INPUT, { careers: [sampleCareer()], rules: sampleRules })).toEqual(EMPTY_INPUT)
  })

  // Asks the policy about a forced end and about a term past the limit, and expects muster and leave.
  it('musters out when forced and leaves at the term limit', () => {
    const result = build(started(SERVICE, PASSING))
    expect(policyChoice({ kind: 'next', key: 'k', forced: true, reason: 'x' }, result, 5)).toBe('muster')
    expect(policyChoice({ kind: 'next', key: 'k', forced: false, reason: undefined }, result, 1)).toBe('leave')
    expect(policyChoice({ kind: 'next', key: 'k', forced: false, reason: undefined }, result, 2)).toBe('continue')
  })
})

// Tests for pruneInput and diceFor.
describe('input pruning and dice streams', () => {
  // Builds a failed-survival career with a saved advancement override, prunes it, and expects the
  // advancement override removed and the survival override kept.
  it('removes overrides for steps that no longer happen', () => {
    const input = started(SERVICE, { qualification: 12, 'term-1.survival': 2, 'term-1.advancement': 12 })
    const { input: pruned, removed } = pruneInput(input, build(input).usedKeys)
    expect(removed).toEqual(['term-1.advancement'])
    expect(pruned.rolls).toEqual({ qualification: 12, 'term-1.survival': 2 })
  })

  // Rolls ten d6 from the same seed and path twice and expects the same sequence, then from another
  // path and expects a different one.
  it('gives each roll path its own repeatable sequence', () => {
    const sequence = (path: string) => {
      const d = diceFor('s', path)
      return Array.from({ length: 10 }, () => d.d6())
    }
    expect(sequence('term-1.survival')).toEqual(sequence('term-1.survival'))
    expect(sequence('term-1.survival')).not.toEqual(sequence('term-1.event'))
  })
})

// Tests for rules in career packs: selectRules and format version 2.
describe('pack rules', () => {
  const other: Rules = { ...sampleRules, termLength: 5 }

  // Passes two packs with different rules in both orders and expects the rules of the pack whose id
  // sorts first, with differ set.
  it('uses the rules of the pack whose id sorts first', () => {
    const a = { id: 'a', name: 'A', rules: other }
    const b = { id: 'b', name: 'B', rules: sampleRules }
    for (const packs of [
      [a, b],
      [b, a],
    ]) {
      expect(selectRules(packs, sampleRules)).toEqual({ rules: other, packName: 'A', differ: true })
    }
  })

  // Passes packs without rules and expects the sample rules with no pack name.
  it('falls back to the sample rules', () => {
    expect(selectRules([{ id: 'a', name: 'A', rules: undefined }], sampleRules)).toEqual({
      rules: sampleRules,
      packName: undefined,
      differ: false,
    })
  })

  // Adds rules to a version 1 pack, then effects to a version 1 career, and expects each rejected
  // with a message that the pack must be version 2; with formatVersion 2 the pack loads with its rules.
  it('requires format version 2 for rules and effects', () => {
    const withRules = { ...structuredClone(validPack), rules: sampleRules }
    expect(parseCareerPack(withRules)).toMatchObject({ ok: false, reason: 'this pack uses "rules", so its "formatVersion" must be 2' })
    const withEffects = { ...structuredClone(validPack), careers: [sampleCareerJson] }
    expect(parseCareerPack(withEffects)).toMatchObject({ ok: false, reason: 'this pack uses "effects", so its "formatVersion" must be 2' })
    const v2 = { ...withRules, formatVersion: 2, careers: [sampleCareerJson] }
    expect(parseCareerPack(v2)).toMatchObject({ ok: true, rules: sampleRules })
  })

  // Parses the bundled sample rules and expects them to pass RulesSchema.
  it('the sample rules pass RulesSchema', () => {
    expect(RulesSchema.safeParse(sampleRules).success).toBe(true)
  })
})

// Tests for saving characters in storage/characters.ts, using an in-memory Storage.
describe('saved characters', () => {
  /** Returns a minimal in-memory Storage. */
  function memory(): Storage {
    const items = new Map<string, string>()
    return {
      get length() {
        return items.size
      },
      clear: () => items.clear(),
      getItem: (k) => items.get(k) ?? null,
      key: (i) => [...items.keys()][i] ?? null,
      removeItem: (k) => void items.delete(k),
      setItem: (k, v) => void items.set(k, v),
    }
  }

  // Saves characters for two seeds, removes one, and expects the other still readable.
  it('saves per seed and removes one without touching others', () => {
    const storage = memory()
    writeSavedCharacter(storage, 'a', { packs: 'p@1', input: started() })
    writeSavedCharacter(storage, 'b', { packs: '', input: EMPTY_INPUT })
    writeSavedCharacter(storage, 'a', undefined)
    expect(readSavedCharacter(storage, 'a')).toBeUndefined()
    expect(readSavedCharacter(storage, 'b')).toEqual({ packs: '', input: EMPTY_INPUT })
  })
})
