import { describe, expect, it } from 'vitest'
import { parseCareerPack } from './career-pack'
import { parseCareer, type CareerDefinition } from './career-schema'
import { newCharacter } from './character'
import { CHARACTERISTICS, type Characteristic } from './characteristics'
import { current } from './overridable'
import { finishCareer } from './policy'
import { buildCareer, EMPTY_INPUT, type CareerData, type CareerInput } from './terms'
import { sampleRules } from '../data/rules'
import sampleCareerJson from '../data/careers/sample-sanitation.json'
import validPack from '../../e2e/fixtures/valid-pack.json'

/** Number of seeds each sweep below runs. */
const SWEEP_SIZE = 200

/** Returns the seeds `sweep-0` to `sweep-<SWEEP_SIZE - 1>`. The list is fixed, so a failure names a seed that reproduces it. */
function sweepSeeds(): string[] {
  return Array.from({ length: SWEEP_SIZE }, (_, i) => `sweep-${i}`)
}

/** Returns the current value of each characteristic of the character rolled from `seed`. */
function baseFor(seed: string): Record<Characteristic, number> {
  const { characteristics } = newCharacter(seed)
  const base: Record<Characteristic, number> = { STR: 0, DEX: 0, END: 0, INT: 0, EDU: 0, SOC: 0 }
  for (const key of CHARACTERISTICS) base[key] = current(characteristics[key])
  return base
}

/** Returns the sample career parsed with parseCareer, or throws if it does not pass. */
function sampleCareer(): CareerDefinition {
  const result = parseCareer(sampleCareerJson)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.career
}

/** Returns the careers of e2e/fixtures/valid-pack.json parsed with parseCareerPack, or throws if it is rejected. */
function validPackCareers(): CareerDefinition[] {
  const result = parseCareerPack(validPack)
  if (!result.ok) throw new Error(result.reason)
  return result.careers
}

/** Returns an input that picks `career` and its first assignment, with no other choices. */
function startOf(career: CareerDefinition): CareerInput {
  const assignment = career.assignments[0]
  if (!assignment) throw new Error(`${career.id} has no assignment`)
  return { ...EMPTY_INPUT, choices: { 'start.career': career.id, 'start.assignment': assignment.id } }
}

// Seed sweeps: each test runs the same check on SWEEP_SIZE fixed seeds instead of one hand-picked seed,
// to check rules that hold for every seed. Each failure message names the seed.
describe('seed sweep invariants', () => {
  // Rolls a character from each seed twice and expects equal characters, and each rolled
  // characteristic to be a 2D total from 2 to 12.
  it('newCharacter repeats for a seed and rolls each characteristic from 2 to 12', () => {
    for (const seed of sweepSeeds()) {
      const first = newCharacter(seed)
      expect(newCharacter(seed), seed).toEqual(first)
      for (const key of CHARACTERISTICS) {
        const value = first.characteristics[key].rolled
        expect(value, `${seed} ${key}`).toBeGreaterThanOrEqual(2)
        expect(value, `${seed} ${key}`).toBeLessThanOrEqual(12)
      }
    }
  })

  // For each seed and each career in the sample career and the valid fixture pack, runs Finish career
  // from the start of the career twice and expects the same input and result both times. Then expects
  // one of two end states: qualification failed (the start choice is pending again with no terms), or
  // the character finished with 1 to termLimit terms and an age of startingAge + terms × termLength.
  it('Finish career repeats for a seed and ends in a failed qualification or a finished character', () => {
    const careers = [sampleCareer(), ...validPackCareers()]
    const data: CareerData = { careers, rules: sampleRules }
    for (const career of careers) {
      for (const seed of sweepSeeds()) {
        const label = `${career.id} ${seed}`
        const base = baseFor(seed)
        const input = finishCareer(seed, base, startOf(career), data)
        expect(finishCareer(seed, base, startOf(career), data), label).toEqual(input)
        const result = buildCareer(seed, base, input, data)
        expect(buildCareer(seed, base, input, data), label).toEqual(result)

        if (!result.finished) {
          expect(result.pending, label).toMatchObject({ kind: 'start', failedQualification: true })
          expect(result.terms, label).toHaveLength(0)
          continue
        }
        expect(result.pending, label).toBeUndefined()
        expect(result.terms.length, label).toBeGreaterThanOrEqual(1)
        expect(result.terms.length, label).toBeLessThanOrEqual(sampleRules.termLimit)
        expect(result.age, label).toBe(sampleRules.startingAge + result.terms.length * sampleRules.termLength)
      }
    }
  })

  // For each seed, starts the sample career with passing qualification, sets term 1 survival dice to 2,
  // and expects the survival check to fail and the term to have a mishap step and no event step.
  it('a term 1 survival dice override of 2 gives a mishap for every seed', () => {
    const data: CareerData = { careers: [sampleCareer()], rules: sampleRules }
    const input: CareerInput = {
      ...startOf(sampleCareer()),
      choices: { ...startOf(sampleCareer()).choices, 'term-1.skill-0.table': 'serviceSkills' },
      rolls: { qualification: 12, 'term-1.survival': 2 },
    }
    for (const seed of sweepSeeds()) {
      const steps = buildCareer(seed, baseFor(seed), input, data).terms[0]?.steps ?? []
      const keys = steps.map((s) => s.key)
      expect(keys, seed).toContain('term-1.mishap')
      expect(keys, seed).not.toContain('term-1.event')
    }
  })
})
