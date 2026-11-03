import { describe, expect, it } from 'vitest'
import { parseCareer, type CareerDefinition } from './career-schema'
import { parseCareerPack, selectRules } from './career-pack'
import { RulesSchema, type Rules } from './rules-schema'
import { diceFor } from './dice'
import { finishedTerms, generateRest, maxMoreTerms, policyChoice } from './policy'
import { asCharacteristic, buildCareer, EMPTY_INPUT, entryOptions, pruneInput, type CareerInput, type CareerResult } from './terms'
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
    expect(failed.pending).toMatchObject({ kind: 'next', forced: 'muster' })

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

// Tests for effects and overrides found in review.
describe('buildCareer effect and override details', () => {
  /** Returns the sample career with the event for roll 7 replaced by one with `effects`. */
  function withEvent7(effects: CareerDefinition['events'][number]['effects']): CareerDefinition {
    const career = sampleCareer()
    return { ...career, events: career.events.map((e) => (e.roll === 7 ? { roll: 7, summary: 'Test event', effects } : e)) }
  }
  const leaveAfter1 = { ...SERVICE, 'term-1.next': 'leave' }
  const event7 = { ...PASSING, 'term-1.event': 7, 'term-1.advancement': 2 }

  // Leaves after one term with rules giving three rolls per term, and expects benefitCount 3 before any roll is made.
  it('reports the total number of benefit rolls', () => {
    const rules: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, perTerm: 3 } }
    expect(build(started(leaveAfter1, event7), rules).benefitCount).toBe(3)
  })

  // Gives a +3 benefit DM, takes cash then a benefit with both dice at 1, and expects the cash roll
  // total 1 and the benefit roll total 4.
  it('a benefit DM applies to the next roll on the benefit table, not a cash roll', () => {
    const rules: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, perTerm: 2, rankBenefitDM: [] } }
    const result = build(
      started({ ...leaveAfter1, 'benefit-0': 'cash', 'benefit-1': 'benefit' }, { ...event7, 'benefit-0': 1, 'benefit-1': 1 }),
      rules,
      withEvent7([{ type: 'benefit-dm', dm: 3 }]),
    )
    expect(result.benefits.map((b) => b.step.total)).toEqual([1, 4])
  })

  // Gives an event a roll on advancedEducation with EDU 7 (below the sample minimum) and expects a
  // note, no extra roll and no empty skill name.
  it('a roll-table effect on a table the character cannot use becomes a note', () => {
    const result = build(started(SERVICE, event7), sampleRules, withEvent7([{ type: 'roll-table', table: 'advancedEducation' }]))
    expect(step(result, 1, 'event').notes[0]).toContain('EDU is below the minimum')
    expect(Object.keys(result.skills)).not.toContain('')
  })

  // Gives a qualification DM from an event and expects it kept in the result for a later career.
  it('keeps a qualification DM for a later career', () => {
    const result = build(started(SERVICE, event7), sampleRules, withEvent7([{ type: 'dm-next', roll: 'qualification', dm: 2 }]))
    expect(result.qualificationDM).toBe(2)
  })

  // Stores a Pass outcome on a survival check that already passes, and expects it unused so pruneInput removes it.
  it('an outcome override equal to the automatic result is not kept', () => {
    const input = started(SERVICE, PASSING, { 'term-1.survival': 'pass' })
    const { removed } = pruneInput(input, build(input).usedKeys)
    expect(removed).toContain('term-1.survival')
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

  // Asks the policy about a forced end, a forced stay past the limit, and a term past the limit, and
  // expects muster, continue and leave.
  it('follows a forced muster or continue, and leaves at the term limit', () => {
    const result = build(started(SERVICE, PASSING))
    expect(policyChoice({ kind: 'next', key: 'k', forced: 'muster', reason: 'x' }, result, 5)).toBe('muster')
    expect(policyChoice({ kind: 'next', key: 'k', forced: 'continue', reason: 'x' }, result, 1)).toBe('continue')
    expect(policyChoice({ kind: 'next', key: 'k', forced: undefined, reason: undefined }, result, 1)).toBe('leave')
    expect(policyChoice({ kind: 'next', key: 'k', forced: undefined, reason: undefined }, result, 2)).toBe('continue')
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

// Checks which skill table entries asCharacteristic reads as characteristic changes.
describe('asCharacteristic', () => {
  // A bare name and the book's "+1" form both give +1; a signed number gives that change.
  it('reads "DEX", "DEX +1", "END+2" and "SOC -1" as characteristic changes', () => {
    expect(asCharacteristic('DEX')).toEqual({ characteristic: 'DEX', change: 1 })
    expect(asCharacteristic('DEX +1')).toEqual({ characteristic: 'DEX', change: 1 })
    expect(asCharacteristic('END+2')).toEqual({ characteristic: 'END', change: 2 })
    expect(asCharacteristic('SOC -1')).toEqual({ characteristic: 'SOC', change: -1 })
  })

  // Skill names, unknown three-letter names and other text return undefined.
  it('returns undefined for skills and other text', () => {
    expect(asCharacteristic('Gun Combat')).toBeUndefined()
    expect(asCharacteristic('ABC +1')).toBeUndefined()
    expect(asCharacteristic('DEX or INT')).toBeUndefined()
    expect(asCharacteristic('dex')).toBeUndefined()
  })
})

// Tests for the part 2a rules (docs/features/career-rules.md): each is switched on by a rules or career
// field and is off without it.
describe('buildCareer rule enforcement', () => {
  /** Returns the sample career with its first assignment changed by `change`. */
  function withAssignment(change: Partial<CareerDefinition['assignments'][number]>): CareerDefinition {
    const career = sampleCareer()
    return { ...career, assignments: career.assignments.map((a, i) => (i === 0 ? { ...a, ...change } : a)) }
  }
  /** Returns the sample career with its mishap for roll 1 given `effects`. */
  function withMishap1(effects: CareerDefinition['mishaps'][number]['effects']): CareerDefinition {
    const career = sampleCareer()
    return { ...career, mishaps: career.mishaps.map((m) => (m.roll === 1 ? { roll: 1, summary: 'Test mishap', effects } : m)) }
  }
  /** Choices and rolls for a term 1 that passes and continues, and a term 2 that fails survival with mishap 1. */
  const mishapInTerm2 = {
    choices: { ...SERVICE, 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills', 'term-2.next': 'muster' },
    rolls: { ...PASSING, 'term-1.event': 9, 'term-1.advancement': 3, 'term-2.survival': 2, 'term-2.mishap': 1 },
  }
  const losesTerm: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, mishapLosesTerm: true } }

  // Sets survival target 2 and survival dice 2: without the rule it passes; with failOnNatural 2 it
  // fails and the step gives the reason.
  it('a natural 2 fails survival when rules.survival.failOnNatural is 2', () => {
    const career = withAssignment({ survival: { characteristic: 'DEX', target: 2 } })
    const input = started(SERVICE, { qualification: 12, 'term-1.survival': 2 })
    expect(step(build(input, sampleRules, career), 1, 'survival').result).toBe('pass')
    const ruled = step(build(input, { ...sampleRules, survival: { failOnNatural: 2 } }, career), 1, 'survival')
    expect(ruled.result).toBe('fail')
    expect(ruled.reasons[0]).toContain('Natural 2')
  })

  // Overrides the outcome of that natural-2 survival to Pass and expects it to pass.
  it('an outcome override beats the natural-fail rule', () => {
    const career = withAssignment({ survival: { characteristic: 'DEX', target: 2 } })
    const input = started(SERVICE, { qualification: 12, 'term-1.survival': 2 }, { 'term-1.survival': 'pass' })
    expect(step(build(input, { ...sampleRules, survival: { failOnNatural: 2 } }, career), 1, 'survival').result).toBe('pass')
  })

  // Fails survival in term 2 and expects 2 benefit rolls without mishapLosesTerm and 1 with it.
  it('a mishap that ends the career loses that term benefit roll when mishapLosesTerm is true', () => {
    const input = started(mishapInTerm2.choices, mishapInTerm2.rolls)
    expect(build(input).benefitCount).toBe(2)
    const ruled = build(input, losesTerm)
    expect(ruled.benefitCount).toBe(1)
    expect(ruled.lostBenefitTerms).toBe(1)
  })

  // Gives mishap 1 keep-benefit and expects 2 benefit rolls with mishapLosesTerm true.
  it('a mishap with keep-benefit keeps the term benefit roll', () => {
    const input = started(mishapInTerm2.choices, mishapInTerm2.rolls)
    expect(build(input, losesTerm, withMishap1([{ type: 'keep-benefit' }])).benefitCount).toBe(2)
  })

  // Gives mishap 1 stay-in-career and expects the term-2 next choice not to be forced.
  it('a mishap with stay-in-career lets the career continue', () => {
    const { 'term-2.next': _ignored, ...choices } = mishapInTerm2.choices
    const result = build(started(choices, mishapInTerm2.rolls), sampleRules, withMishap1([{ type: 'stay-in-career' }]))
    expect(result.pending).toEqual({ kind: 'next', key: 'term-2.next', forced: undefined, reason: undefined })
  })

  // Passes term 1, then rolls advancement 2 in term 2 (total 2, at or below 2 terms) and expects a forced muster with the reason.
  it('an advancement total at or below the terms served forces leaving when leaveAtOrBelowTerms is true', () => {
    const rules: Rules = { ...sampleRules, advancement: { leaveAtOrBelowTerms: true } }
    const input = started(
      { ...SERVICE, 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' },
      { ...PASSING, 'term-1.event': 9, 'term-1.advancement': 3, 'term-2.survival': 12, 'term-2.event': 9, 'term-2.advancement': 2 },
    )
    expect(build(input).pending).toMatchObject({ kind: 'next', forced: undefined })
    const ruled = build(input, rules)
    expect(ruled.pending).toMatchObject({ kind: 'next', key: 'term-2.next', forced: 'muster' })
    expect(step(ruled, 2, 'advancement').reasons[0]).toContain('at or below 2 terms')
  })

  // Rolls advancement 12 in term 1 with stayOnNatural 12, stores "leave", and expects a forced continue.
  it('natural 12 on advancement forces staying when stayOnNatural is 12', () => {
    const rules: Rules = { ...sampleRules, advancement: { stayOnNatural: 12 } }
    const input = started(
      { ...SERVICE, 'term-1.advancement-skill-0.table': 'serviceSkills', 'term-1.next': 'leave' },
      { ...PASSING, 'term-1.advancement': 12 },
    )
    expect(build(input).finished).toBe(false)
    expect(build(input).pending).toMatchObject({ kind: 'benefit' })
    expect(build(input, rules).pending).toMatchObject({ kind: 'next', key: 'term-1.next', forced: 'continue' })
  })

  // With maxLevel 1, rolls Vacc Suit twice in term 1 (after Vacc Suit 0 from basic training) and
  // expects Vacc Suit 1 and a Lost reason on the second roll.
  it('a skill gain above skillLimits.maxLevel is lost', () => {
    const rules: Rules = { ...sampleRules, skillLimits: { maxLevel: 1 } }
    const result = build(
      started({ ...SERVICE, 'term-1.advancement-skill-0.table': 'serviceSkills' }, { ...PASSING, 'term-1.skill-0': 1, 'term-1.advancement': 12, 'term-1.advancement-skill-0': 1 }),
      rules,
    )
    expect(result.skills['Vacc Suit']).toBe(1)
    expect(step(result, 1, 'advancement-skill-0').reasons[0]).toContain('Lost: Vacc Suit 2')
  })

  // With totalPerIntEdu 0 the limit is 0 levels, so the first skill roll (Vacc Suit 1) is lost.
  it('a skill gain above totalPerIntEdu × (INT + EDU) is lost', () => {
    const rules: Rules = { ...sampleRules, skillLimits: { totalPerIntEdu: 0 } }
    const result = build(started(SERVICE, { ...PASSING, 'term-1.skill-0': 1 }), rules)
    expect(result.skills['Vacc Suit']).toBe(0)
    expect(step(result, 1, 'skill-0').reasons[0]).toContain('above 0 × (INT + EDU) = 0')
  })

  // With a +2 rank DM from rank 0, a cash roll of 1 totals 3.
  it('the rank benefit DM applies to cash rolls', () => {
    const rules: Rules = { ...sampleRules, benefits: { ...sampleRules.benefits, rankBenefitDM: [{ minRank: 0, dm: 2 }] } }
    const result = build(started({ ...SERVICE, 'term-1.next': 'leave', 'benefit-0': 'cash' }, { ...PASSING, 'term-1.advancement': 2, 'benefit-0': 1 }), rules)
    expect(result.benefits[0]?.step.total).toBe(3)
  })

  // With cashSkillDM Vacc Suit +1 (Vacc Suit 0 from basic training), a cash roll of 1 totals 2 and a benefit roll of 1 totals 1.
  it('cashSkillDM applies to cash rolls only, for a skill at any level', () => {
    const rules: Rules = {
      ...sampleRules,
      benefits: { ...sampleRules.benefits, perTerm: 2, rankBenefitDM: [], cashSkillDM: { skill: 'Vacc Suit', dm: 1 } },
    }
    const result = build(
      started({ ...SERVICE, 'term-1.next': 'leave', 'benefit-0': 'cash', 'benefit-1': 'benefit' }, { ...PASSING, 'term-1.event': 9, 'term-1.advancement': 2, 'benefit-0': 1, 'benefit-1': 1 }),
      rules,
    )
    expect(result.benefits.map((b) => b.step.total)).toEqual([2, 1])
  })

  // Marks qualification automatic and sets its dice to 2; expects a pass with no dice.
  it('automatic qualification passes without a roll', () => {
    const career = { ...sampleCareer(), qualification: { characteristic: 'END' as const, target: 12, automatic: true } }
    const result = build(started(SERVICE, { qualification: 2, 'term-1.survival': 12 }), sampleRules, career)
    expect(result.qualification?.result).toBe('pass')
    expect(result.qualification?.dice).toBeUndefined()
  })

  // Sets automaticAt 7 with END 7 and expects no roll; sets automaticAt 8 and expects a roll.
  it('automaticAt qualifies without a roll when the characteristic is high enough', () => {
    const at = (automaticAt: number) => ({ ...sampleCareer(), qualification: { characteristic: 'END' as const, target: 5, automaticAt } })
    expect(build(started(SERVICE, PASSING), sampleRules, at(7)).qualification?.dice).toBeUndefined()
    expect(build(started(SERVICE, PASSING), sampleRules, at(8)).qualification?.dice).toBeDefined()
  })

  // Uses a qualification on STR or INT with INT 12 (DM +2) and expects INT used and dice 6 to reach 8.
  it('a check on a list of characteristics uses the highest DM', () => {
    const career = { ...sampleCareer(), qualification: { characteristic: ['STR' as const, 'INT' as const], target: 8 } }
    const result = buildCareer(SEED, { ...BASE, INT: 12 }, started(SERVICE, { qualification: 6 }), { careers: [career], rules: sampleRules })
    expect(result.qualification?.characteristic).toBe('INT')
    expect(result.qualification?.total).toBe(8)
  })

  // Sets an age DM of -2 from age 18 (the sample starting age) and expects qualification DM -2.
  it('a qualification age DM applies from fromAge', () => {
    const career = { ...sampleCareer(), qualification: { characteristic: 'END' as const, target: 5, ageDM: { fromAge: 18, dm: -2 } } }
    expect(build(started(SERVICE, PASSING), sampleRules, career).qualification?.dm).toBe(-2)
  })

  // Sets basicTraining "assignment" and expects basic training to give the assignment's Gunner, not the service skill Broker.
  it('basicTraining "assignment" trains in the assignment skills', () => {
    const career: CareerDefinition = { ...sampleCareer(), basicTraining: 'assignment' }
    const result = build(started(SERVICE, PASSING), sampleRules, career)
    expect(result.skills['Gunner']).toBe(0)
    expect(Object.keys(result.skills)).not.toContain('Broker')
  })

  // Replaces a service skill with "Drive or Flyer" and expects basic training to ask for a pick, then gives Drive 0.
  it('an "A or B" table entry asks the player to pick one', () => {
    const career = sampleCareer()
    const changed: CareerDefinition = {
      ...career,
      skillTables: { ...career.skillTables, serviceSkills: career.skillTables.serviceSkills.map((e, i) => (i === 1 ? 'Drive or Flyer' : e)) },
    }
    expect(build(started(SERVICE, PASSING), sampleRules, changed).pending).toEqual({
      kind: 'skill-option',
      key: 'term-1.training.pick-1',
      options: ['Drive', 'Flyer'],
    })
    const picked = build(started({ ...SERVICE, 'term-1.training.pick-1': 'Drive' }, PASSING), sampleRules, changed)
    expect(picked.skills['Drive']).toBe(0)
  })

  // Splits entries on " or " outside parentheses only.
  it('entryOptions splits on " or " outside parentheses', () => {
    expect(entryOptions('Drive or Vacc Suit')).toEqual(['Drive', 'Vacc Suit'])
    expect(entryOptions('Pilot (small craft or spacecraft)')).toEqual(['Pilot (small craft or spacecraft)'])
    expect(entryOptions('Gun Combat')).toEqual(['Gun Combat'])
  })

  // Gives event 7 a promote effect and expects advancement to pass without dice and rank 1.
  it('a promote effect passes advancement without a roll', () => {
    const career = sampleCareer()
    const promoted: CareerDefinition = {
      ...career,
      events: career.events.map((e) => (e.roll === 7 ? { roll: 7, summary: 'Promoted', effects: [{ type: 'promote' }] } : e)),
    }
    const result = build(
      started({ ...SERVICE, 'term-1.advancement-skill-0.table': 'serviceSkills' }, { ...PASSING, 'term-1.event': 7, 'term-1.advancement': 2 }),
      sampleRules,
      promoted,
    )
    expect(step(result, 1, 'advancement').dice).toBeUndefined()
    expect(result.rank).toBe(1)
  })

  // Uses aging from term 1 with a row that takes STR 7 down by 7, and expects an ageing crisis reason.
  it('aging that takes a characteristic to 0 shows an ageing crisis', () => {
    const rules: Rules = {
      ...sampleRules,
      aging: { ...sampleRules.aging, fromTerm: 1, table: [{ roll: 0, summary: 'Test', effects: [{ type: 'characteristic', characteristic: 'STR', change: -7 }] }] },
    }
    const result = build(started(SERVICE, PASSING), rules)
    expect(step(result, 1, 'aging').reasons).toContain('Ageing crisis: STR is 0 or lower. Resolve it by hand.')
  })
})

// Tests for the review fixes and the Generate the rest term count.
describe('generateRest term count and review fixes', () => {
  const data = { careers: [sampleCareer()], rules: sampleRules }
  /** Rolls that pass qualification and survival in terms 1 to 5 and keep advancement at 3. */
  const surviving: Record<string, number> = { qualification: 12 }
  for (let n = 1; n <= 5; n += 1) {
    surviving[`term-${n}.survival`] = 12
    surviving[`term-${n}.advancement`] = 3
  }

  // Generates 2 more terms from the start of term 1 and expects 2 terms and a finished character.
  it('plays the number of terms asked for', () => {
    const result = build(generateRest(SEED, BASE, started({}, surviving), data, 2))
    expect(result.terms).toHaveLength(2)
    expect(result.finished).toBe(true)
  })

  // Asks for 50 more terms and expects the sample termLimit (5) instead.
  it('caps the terms at the rules termLimit', () => {
    expect(build(generateRest(SEED, BASE, started({}, surviving), data, 50)).terms).toHaveLength(sampleRules.termLimit)
  })

  // Finishes term 1, then expects 1 finished term and termLimit - 1 more terms allowed.
  it('finishedTerms counts a term once its after-term choice is pending', () => {
    const inProgress = build(started({}, surviving))
    expect(finishedTerms(inProgress)).toBe(0)
    const done = build(started({ ...SERVICE }, { ...surviving, 'term-1.event': 9 }))
    expect(done.pending).toMatchObject({ kind: 'next' })
    expect(finishedTerms(done)).toBe(1)
    expect(maxMoreTerms(done, sampleRules.termLimit)).toBe(sampleRules.termLimit - 1)
  })

  // Uses aging from term 1 that takes STR from 7 to 0, and expects generation to stop at term 1's after-term choice.
  it('stops at an ageing crisis', () => {
    const rules: Rules = {
      ...sampleRules,
      aging: { ...sampleRules.aging, fromTerm: 1, table: [{ roll: 0, summary: 'Test', effects: [{ type: 'characteristic', characteristic: 'STR', change: -7 }] }] },
    }
    const result = build(generateRest(SEED, BASE, started({}, surviving), { careers: [sampleCareer()], rules }, 5), rules)
    expect(result.terms).toHaveLength(1)
    expect(result.terms[0]?.ageingCrisis).toBe(true)
    expect(result.pending).toMatchObject({ kind: 'next', key: 'term-1.next' })
  })

  // Starts with STR 0 and an aging row with no effects, and expects no ageing crisis.
  it('a characteristic already at 0 before aging is not an ageing crisis', () => {
    const rules: Rules = { ...sampleRules, aging: { ...sampleRules.aging, fromTerm: 1, table: [{ roll: 0, summary: 'Test', effects: [] }] } }
    const result = buildCareer(SEED, { ...BASE, STR: 0 }, started(SERVICE, PASSING), { careers: [sampleCareer()], rules })
    expect(result.terms[0]?.ageingCrisis).toBe(false)
  })

  // Qualifies on DEX or INT with automaticAt 10, DEX 9 and INT 10 (both DM +1), and expects automatic qualification.
  it('automaticAt passes when any listed characteristic reaches it', () => {
    const career = { ...sampleCareer(), qualification: { characteristic: ['DEX' as const, 'INT' as const], target: 12, automaticAt: 10 } }
    const result = buildCareer(SEED, { ...BASE, DEX: 9, INT: 10 }, started(SERVICE, { qualification: 2 }), { careers: [career], rules: sampleRules })
    expect(result.qualification?.dice).toBeUndefined()
    expect(result.qualification?.result).toBe('pass')
  })

  // With INT 1, EDU 1 and totalPerIntEdu 1, gains Vacc Suit 1 in term 1, then term 1 aging takes INT
  // and EDU to 0 (limit 0). A term 2 event that sets Vacc Suit to at least 0 adds no levels, so it
  // gives no Lost reason.
  it('the total skill limit does not stop gains that add no levels', () => {
    const rules: Rules = {
      ...sampleRules,
      skillLimits: { totalPerIntEdu: 1 },
      aging: {
        ...sampleRules.aging,
        fromTerm: 1,
        table: [{ roll: 0, summary: 'Test', effects: [{ type: 'characteristic', characteristic: 'INT', change: -1 }, { type: 'characteristic', characteristic: 'EDU', change: -1 }] }],
      },
    }
    const career = sampleCareer()
    const withEvent: CareerDefinition = {
      ...career,
      events: career.events.map((e) => (e.roll === 7 ? { roll: 7, summary: 'Test', effects: [{ type: 'skill', options: ['Vacc Suit'], level: 0 }] } : e)),
    }
    const input = started(
      { ...SERVICE, 'term-1.next': 'continue', 'term-2.skill-0.table': 'serviceSkills' },
      { ...PASSING, 'term-1.skill-0': 1, 'term-1.event': 9, 'term-1.advancement': 3, 'term-2.skill-0': 1, 'term-2.survival': 12, 'term-2.event': 7 },
    )
    const result = buildCareer(SEED, { ...BASE, INT: 1, EDU: 1 }, input, { careers: [withEvent], rules })
    expect(result.skills['Vacc Suit']).toBe(1)
    expect(step(result, 2, 'event').reasons).toEqual([])
  })

  // Replaces a service skill with "STR or Athletics" and expects basic training to give Athletics 0 without asking.
  it('basic training does not offer characteristic options', () => {
    const career = sampleCareer()
    const changed: CareerDefinition = {
      ...career,
      skillTables: { ...career.skillTables, serviceSkills: career.skillTables.serviceSkills.map((e, i) => (i === 1 ? 'STR or Athletics' : e)) },
    }
    const result = build(started(SERVICE, PASSING), sampleRules, changed)
    expect(result.skills['Athletics']).toBe(0)
    expect(result.pending?.kind).not.toBe('skill-option')
  })
})
