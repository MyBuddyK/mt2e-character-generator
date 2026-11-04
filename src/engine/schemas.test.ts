import { describe, expect, it } from 'vitest'
import { parseCareerPack, parsePackRefs, selectRules } from './career-pack'
import { parseCareer } from './career-schema'
import { EffectSchema } from './effects'
import { policyChoice } from './policy'
import { RulesSchema, type Rules } from './rules-schema'
import { buildCareer, EMPTY_INPUT, type CareerResult } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'
import validPack from '../../e2e/fixtures/valid-pack.json'

// Tests added after the first Stryker run (npm run test:mutation) showed schema limits and policy
// branches that no unit test checked. Each schema test checks one value just inside a limit and one
// just outside it.

/** Returns true when RulesSchema accepts the sample rules with `change` merged in. */
function rulesPass(change: Record<string, unknown>): boolean {
  return RulesSchema.safeParse({ ...sampleRules, ...change }).success
}

/** Returns true when parseCareer accepts the sample career with `change` merged in. */
function careerPasses(change: Record<string, unknown>): boolean {
  return parseCareer({ ...sampleCareerJson, ...change }).ok
}

/** Returns true when EffectSchema accepts `effect`. */
function effectPasses(effect: unknown): boolean {
  return EffectSchema.safeParse(effect).success
}

// Tests for the limits in RulesSchema.
describe('RulesSchema limits', () => {
  // Sets source to spaces and expects a rejection; a non-blank source passes.
  it('rejects a blank source', () => {
    expect(rulesPass({ source: '   ' })).toBe(false)
    expect(rulesPass({ source: 'x' })).toBe(true)
  })

  // Sets basicTraining.level to -1 and 0 and expects a rejection and a pass.
  it('rejects a negative basic training level', () => {
    expect(rulesPass({ basicTraining: { table: 'serviceSkills', level: -1 } })).toBe(false)
    expect(rulesPass({ basicTraining: { table: 'serviceSkills', level: 0 } })).toBe(true)
  })

  // Sets each optional rules field to its lowest allowed value and expects a pass, then one below
  // it (or a blank name) and expects a rejection.
  it('accepts each optional field at its lowest value and rejects one below it', () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ survival: { failOnNatural: 0 } }, { survival: { failOnNatural: -1 } }],
      [{ advancement: { stayOnNatural: 2, leaveAtOrBelowTerms: true } }, { advancement: { stayOnNatural: 1 } }],
      [{ skillLimits: { maxLevel: 0, totalPerIntEdu: 0 } }, { skillLimits: { maxLevel: -1 } }],
      [{ skillLimits: { totalPerIntEdu: 0 } }, { skillLimits: { totalPerIntEdu: -1 } }],
      [{ fallbackCareer: 'drifter' }, { fallbackCareer: '  ' }],
      [{ draft: [{ roll: 1, career: 'navy' }] }, { draft: [{ roll: 1, career: ' ' }] }],
      [{ draft: [{ roll: 1, career: 'navy', assignment: 'crew' }] }, { draft: [{ roll: 1, career: 'navy', assignment: ' ' }] }],
      [
        { benefits: { ...sampleRules.benefits, cashSkillDM: { skill: 'Gambler', dm: 1 } } },
        { benefits: { ...sampleRules.benefits, cashSkillDM: { skill: ' ', dm: 1 } } },
      ],
      [
        { aging: { ...sampleRules.aging, crisis: { costDice: 1, costPerDie: 0 } } },
        { aging: { ...sampleRules.aging, crisis: { costDice: 0, costPerDie: 0 } } },
      ],
      [
        { anagathics: { characteristic: 'SOC', target: 10, costDice: 1, costPerDie: 0, prisonOnNatural: 2 } },
        { anagathics: { characteristic: 'SOC', target: 10, costDice: 0, costPerDie: 0 } },
      ],
      [
        { anagathics: { characteristic: 'SOC', target: 10, costDice: 1, costPerDie: 0, prisonOnNatural: 2 } },
        { anagathics: { characteristic: 'SOC', target: 10, costDice: 1, costPerDie: 0, prisonOnNatural: 1 } },
      ],
    ]
    for (const [inside, outside] of cases) {
      expect(rulesPass(inside), JSON.stringify(inside)).toBe(true)
      expect(rulesPass(outside), JSON.stringify(outside)).toBe(false)
    }
  })

  // Lists the aging rows in reverse order and expects a pass: rows only need consecutive rolls, in any
  // order. Removing the middle row is rejected.
  it('accepts aging rows in any order but not with a gap', () => {
    const rows = sampleRules.aging.table
    expect(rulesPass({ aging: { ...sampleRules.aging, table: [...rows].reverse() } })).toBe(true)
    expect(rulesPass({ aging: { ...sampleRules.aging, table: rows.filter((_, i) => i !== 1) } })).toBe(false)
  })

  // Sets an aging row's summary to spaces and expects a rejection.
  it('rejects an aging row with a blank summary', () => {
    const table = sampleRules.aging.table.map((r, i) => (i === 0 ? { ...r, summary: ' ' } : r))
    expect(rulesPass({ aging: { ...sampleRules.aging, table } })).toBe(false)
  })
})

// Tests for the limits in the career schema and EffectSchema.
describe('career and effect limits', () => {
  // Sets the career name to spaces and expects a rejection.
  it('rejects a blank career name', () => {
    expect(careerPasses({ name: '  ' })).toBe(false)
  })

  // Sets the qualification check to an empty characteristic list, then to a two-item list, and expects
  // a rejection and a pass.
  it('a check needs at least one characteristic', () => {
    expect(careerPasses({ qualification: { characteristic: [], target: 5 } })).toBe(false)
    expect(careerPasses({ qualification: { characteristic: ['END', 'DEX'], target: 5 } })).toBe(true)
  })

  // Sets automaticAt and ageDM.fromAge to 0 (pass) and -1 (rejection).
  it('automaticAt and ageDM.fromAge start at 0', () => {
    expect(careerPasses({ qualification: { characteristic: 'END', target: 5, automaticAt: 0 } })).toBe(true)
    expect(careerPasses({ qualification: { characteristic: 'END', target: 5, automaticAt: -1 } })).toBe(false)
    expect(careerPasses({ qualification: { characteristic: 'END', target: 5, ageDM: { fromAge: 0, dm: -1 } } })).toBe(true)
    expect(careerPasses({ qualification: { characteristic: 'END', target: 5, ageDM: { fromAge: -1, dm: -1 } } })).toBe(false)
  })

  // Lists the events in reverse roll order and expects a pass.
  it('accepts events in any order', () => {
    expect(careerPasses({ events: [...sampleCareerJson.events].reverse() })).toBe(true)
  })

  // Sets officerRanks to an empty list and expects a rejection.
  it('rejects an empty officerRanks list', () => {
    expect(careerPasses({ officerRanks: [] })).toBe(false)
  })

  // Checks each effect field at its lowest allowed value (pass) and one below it (rejection). For
  // dm-next, dm-later and choice it checks an allowed value against one the schema rejects: an unknown
  // roll kind, an empty kind list, one option, a label used twice and a choice inside a choice.
  // Criteria: EC-1.
  it('accepts each effect field at its limit and rejects one past it', () => {
    const cases: [unknown, unknown][] = [
      [{ type: 'skill', options: ['Pilot'] }, { type: 'skill', options: [' '] }],
      [{ type: 'extra-benefit', count: 1 }, { type: 'extra-benefit', count: 0 }],
      [{ type: 'dm-next', roll: 'survival', dm: 1 }, { type: 'dm-next', roll: 'aging', dm: 1 }],
      [{ type: 'dm-later', dm: 4, rolls: ['advancement'] }, { type: 'dm-later', dm: 4, rolls: [] }],
      [{ type: 'dm-later', dm: 4 }, { type: 'dm-later', dm: 4, rolls: ['event'] }],
      [
        { type: 'choice', options: [{ label: 'A' }, { label: 'B' }] },
        { type: 'choice', options: [{ label: 'A' }] },
      ],
      [
        { type: 'choice', options: [{ label: 'A' }, { label: 'B' }] },
        { type: 'choice', options: [{ label: 'A' }, { label: 'A' }] },
      ],
      [
        { type: 'choice', options: [{ label: 'A', effects: [{ type: 'promote' }] }, { label: 'B' }] },
        { type: 'choice', options: [{ label: 'A', effects: [{ type: 'choice', options: [{ label: 'C' }, { label: 'D' }] }] }, { label: 'B' }] },
      ],
      [{ type: 'reduce', characteristics: ['STR'], amounts: [1] }, { type: 'reduce', characteristics: [], amounts: [1] }],
      [{ type: 'reduce', characteristics: ['STR'], amounts: [1] }, { type: 'reduce', characteristics: ['STR'], amounts: [] }],
      [{ type: 'reduce', characteristics: ['STR'], amounts: [1] }, { type: 'reduce', characteristics: ['STR'], amounts: [0] }],
      [{ type: 'wager', skills: ['Gambler'], target: 0 }, { type: 'wager', skills: [], target: 8 }],
      [{ type: 'wager', skills: ['Gambler'], target: 20 }, { type: 'wager', skills: ['Gambler'], target: 21 }],
      [{ type: 'wager', skills: ['Gambler'], target: 0 }, { type: 'wager', skills: ['Gambler'], target: -1 }],
      [{ type: 'wager', skills: ['Gambler'], target: 8, maxWager: 1 }, { type: 'wager', skills: ['Gambler'], target: 8, maxWager: 0 }],
    ]
    for (const [inside, outside] of cases) {
      expect(effectPasses(inside), JSON.stringify(inside)).toBe(true)
      expect(effectPasses(outside), JSON.stringify(outside)).toBe(false)
    }
  })
})

// Tests for pack-level checks in career-pack.ts.
describe('career pack details', () => {
  // Gives the pack an id of spaces and expects a rejection; an empty careers list is also rejected.
  it('rejects a blank id and an empty careers list', () => {
    expect(parseCareerPack({ ...validPack, id: '  ' }).ok).toBe(false)
    expect(parseCareerPack({ ...validPack, careers: [] }).ok).toBe(false)
  })

  // Parses packs that fail on format, version and type and expects each to list no problems.
  it('a rejected pack lists no per-career problems', () => {
    for (const data of [[], { ...validPack, format: 'x' }, { ...validPack, formatVersion: 4 }]) {
      const result = parseCareerPack(data)
      expect(result.ok).toBe(false)
      expect(result.problems).toEqual([])
    }
  })

  // Gives a version 1 pack effects on a rank only, then on a mishap only, and expects each rejected
  // for using effects; with no effects anywhere it loads.
  it('a version 1 pack is rejected for effects on a rank or a mishap', () => {
    const career = validPack.careers[0]
    if (!career) throw new Error('fixture')
    const onRank = {
      ...career,
      assignments: career.assignments.map((a, i) =>
        i === 1 ? { ...a, ranks: a.ranks.map((r) => (r.rank === 1 ? { ...r, effects: [] } : r)) } : a,
      ),
    }
    const onMishap = { ...career, mishaps: career.mishaps.map((m) => ({ ...m, effects: [] })) }
    for (const changed of [onRank, onMishap]) {
      const result = parseCareerPack({ ...validPack, careers: [changed] })
      expect(result.ok === false && result.reason).toBe('this pack uses "effects", so its "formatVersion" must be 2')
    }
    expect(parseCareerPack({ ...validPack, careers: [career] }).ok).toBe(true)
  })

  // Parses refs written out of order and expects them sorted by id.
  it('parsePackRefs sorts by id', () => {
    expect(parsePackRefs('b@2,a@1,c@3').map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  // Passes two packs with the same rules and expects differ false; with different rules, true.
  it('selectRules reports differ only when the rules differ', () => {
    const other: Rules = { ...sampleRules, termLimit: sampleRules.termLimit + 1 }
    const same = selectRules([{ id: 'a', name: 'A', rules: sampleRules }, { id: 'b', name: 'B', rules: sampleRules }], sampleRules)
    expect(same.differ).toBe(false)
    const differ = selectRules([{ id: 'b', name: 'B', rules: other }, { id: 'a', name: 'A', rules: sampleRules }], sampleRules)
    expect(differ).toMatchObject({ packName: 'A', differ: true })
  })
})

// Tests for policyChoice branches in policy.ts.
describe('policyChoice details', () => {
  /** A career result with no choices made, as policyChoice reads only its runs. */
  function emptyResult(): CareerResult {
    const career = parseCareer(sampleCareerJson)
    if (!career.ok) throw new Error('fixture')
    return buildCareer('policy', { STR: 7, DEX: 7, END: 7, INT: 7, EDU: 7, SOC: 7 }, EMPTY_INPUT, { careers: [career.career], rules: sampleRules })
  }

  // Asks about the first benefit roll with cash allowed (cash), with cash not allowed (benefit), and a
  // later roll with cash allowed (benefit).
  it('takes cash on the first benefit roll only, and only when allowed', () => {
    const result = emptyResult()
    const benefit = (index: number, cashAllowed: boolean) =>
      policyChoice({ kind: 'benefit', key: `benefit-${index}`, index, count: 3, cashAllowed }, result, 5, 'p')
    expect(benefit(0, true)).toBe('cash')
    expect(benefit(0, false)).toBe('benefit')
    expect(benefit(1, true)).toBe('benefit')
  })

  // Asks for a skill table from three options and expects the last one.
  it('rolls on the last skill table offered', () => {
    expect(policyChoice({ kind: 'skill-table', key: 'k', options: ['personalDevelopment', 'serviceSkills', 'assignment'] }, emptyResult(), 5, 'p')).toBe('assignment')
  })

  // Asks for a wager with max 2 under 60 keys and expects every answer from 0 to 2 to come up, and no other.
  it('wagers any whole number from 0 to max', () => {
    const result = emptyResult()
    const answers = new Set<string | undefined>()
    for (let i = 0; i < 60; i += 1) {
      answers.add(policyChoice({ kind: 'wager', key: `w-${i}`, max: 2, skills: ['Gambler'], target: 8 }, result, 5, 'p'))
    }
    expect([...answers].sort()).toEqual(['0', '1', '2'])
  })
})
