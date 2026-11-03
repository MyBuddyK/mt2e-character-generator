import { diceFor } from './dice'
import {
  CHARACTERISTICS,
  characteristicDM,
  normalizeCharacteristic,
  type Characteristic,
} from './characteristics'
import type { Assignment, CareerDefinition, Check } from './career-schema'
import type { Effect, SkillTableKey } from './effects'
import { SKILL_TABLES } from './effects'
import { current, isOverridden, type Overridable } from './overridable'
import type { Rules } from './rules-schema'

/**
 * The career engine for one career, term by term (docs/features/career-terms.md, part 1).
 * buildCareer is a pure function: it rebuilds the whole career from the seed, the player's
 * choices and overrides, and the data. Every roll uses its own dice stream from diceFor, keyed by
 * the roll's path, so overriding one roll changes only what follows from it.
 */

/** The player's input to buildCareer. Each record is keyed by a choice or roll path. */
export interface CareerInput {
  /** Decisions: "start.career", "start.assignment", "<term>.skill-<n>.table", "<term>.next", "benefit-<n>", ... */
  choices: Record<string, string>
  /** Dice total overrides, keyed by roll path. */
  rolls: Record<string, number>
  /** Pass or fail overrides for checks, keyed by roll path. */
  outcomes: Record<string, 'pass' | 'fail'>
  /** Free-text notes, keyed by term ("term-1"). buildCareer does not read them. */
  notes: Record<string, string>
}

/** A CareerInput with nothing chosen or overridden. */
export const EMPTY_INPUT: CareerInput = { choices: {}, rolls: {}, outcomes: {}, notes: {} }

/** The choice buildCareer needs next, with the key to store the answer under in CareerInput.choices. */
export type PendingChoice =
  | { kind: 'start'; failedQualification: boolean }
  | { kind: 'skill-table'; key: string; options: SkillTableKey[] }
  | { kind: 'skill-option'; key: string; options: string[] }
  | { kind: 'next'; key: string; forced: boolean; reason: string | undefined }
  | { kind: 'benefit'; key: string; index: number; cashAllowed: boolean }

/**
 * One line of a term. Roll steps have `dice` (the dice total, overridable), `dm`, and `total`;
 * checks also have `target` and `passed` (overridable). Info steps (basic training, a rank
 * reached) have no dice.
 */
export interface Step {
  key: string
  label: string
  dice?: Overridable<number>
  diceCount?: number
  dm?: number
  total?: number
  target?: number
  characteristic?: Characteristic
  passed?: Overridable<boolean>
  /** True when the total was outside the table and the nearest row was used. */
  outOfRange?: boolean
  /** What happened, as shown to the player (for example a table entry or event summary). */
  result: string
  /** True when the entry is marked as a connection opportunity. */
  connection?: boolean
  /** Effects the engine applied, described for the player. */
  applied: string[]
  /** Text the player has to apply by hand (an entry or rank bonus with no structured effects). */
  notes: string[]
}

/** One term of the career. */
export interface TermResult {
  number: number
  ageStart: number
  ageEnd: number
  steps: Step[]
  rank: number
  title: string | undefined
  /** Why the career ends after this term, or undefined when the player may continue. */
  endReason: string | undefined
}

/** One mustering-out roll. */
export interface BenefitResult {
  step: Step
  table: 'cash' | 'benefit'
  cash: number
  benefit: string | undefined
}

/** A connection opportunity: an event or mishap marked with `connection: true`. */
export interface ConnectionOpportunity {
  term: number
  label: string
  summary: string
}

/** The result of buildCareer. */
export interface CareerResult {
  career: CareerDefinition | undefined
  assignment: Assignment | undefined
  qualification: Step | undefined
  terms: TermResult[]
  /** Skill levels gained, in the order first gained. */
  skills: Record<string, number>
  /** Changes to each characteristic from effects and aging. */
  characteristicChanges: Record<Characteristic, number>
  rank: number
  title: string | undefined
  age: number
  benefits: BenefitResult[]
  /** How many mustering-out rolls the character gets, or 0 before mustering out. */
  benefitCount: number
  /** A DM from a dm-next effect for the next career's qualification roll (used by a later career). */
  qualificationDM: number
  cash: number
  connections: ConnectionOpportunity[]
  /** The next choice to make, or undefined once the character has mustered out. */
  pending: PendingChoice | undefined
  finished: boolean
  /** The keys of `choices`, `rolls` and `outcomes` that this build read. Others no longer apply. */
  usedKeys: Set<string>
  /** Saved choices that name a career or assignment that isn't loaded. */
  problems: string[]
}

/** The data buildCareer reads: the careers to choose from and the rules values. */
export interface CareerData {
  careers: CareerDefinition[]
  rules: Rules
}

/** Thrown inside buildCareer to stop at the first choice that hasn't been made. */
class Stop {
  readonly pending: PendingChoice
  constructor(pending: PendingChoice) {
    this.pending = pending
  }
}

/** Returns the display name of a skill table. */
export function skillTableName(table: SkillTableKey): string {
  switch (table) {
    case 'personalDevelopment':
      return 'Personal development'
    case 'serviceSkills':
      return 'Service skills'
    case 'assignment':
      return 'Assignment skills'
    case 'advancedEducation':
      return 'Advanced education'
  }
}

/**
 * Reads a skill table entry that changes a characteristic: a characteristic name alone ("DEX"), which
 * means +1, or a name followed by a signed whole number ("DEX +1", "SOC -1"). Returns the
 * characteristic and the change, or undefined when the entry is anything else (a skill).
 */
export function asCharacteristic(entry: string): { characteristic: Characteristic; change: number } | undefined {
  const match = /^([A-Z]{3})(?:\s*([+-]\d+))?$/.exec(entry.trim())
  if (!match) return undefined
  const characteristic = CHARACTERISTICS.find((c) => c === match[1])
  if (!characteristic) return undefined
  return { characteristic, change: match[2] === undefined ? 1 : Number(match[2]) }
}

/**
 * Builds a career from `seed`, the base characteristic values `base` (after the player's
 * overrides), the player's `input` and `data`. It stops at the first choice in `input.choices` that
 * is missing and returns it as `pending`. A saved choice that names a career or assignment that
 * isn't in `data` is reported in `problems` and treated as missing. It does not throw.
 */
export function buildCareer(
  seed: string,
  base: Record<Characteristic, number>,
  input: CareerInput,
  data: CareerData,
): CareerResult {
  const { rules } = data
  const usedKeys = new Set<string>()
  const changes: Record<Characteristic, number> = { STR: 0, DEX: 0, END: 0, INT: 0, EDU: 0, SOC: 0 }
  const skills: Record<string, number> = {}
  const terms: TermResult[] = []
  const benefits: BenefitResult[] = []
  const connections: ConnectionOpportunity[] = []
  const problems: string[] = []
  let career: CareerDefinition | undefined
  let assignment: Assignment | undefined
  let qualification: Step | undefined
  let rank = 0
  let title: string | undefined
  let pending: PendingChoice | undefined
  let finished = false
  const nextDM = { advancement: 0, qualification: 0 }
  let benefitDM = 0
  let extraBenefits = 0
  let benefitCount = 0

  const value = (c: Characteristic) => normalizeCharacteristic(base[c] + changes[c]) ?? 0
  const choice = (key: string): string | undefined => {
    const v = input.choices[key]
    if (v !== undefined) usedKeys.add(key)
    return v
  }
  // An override equal to the rolled value or the automatic result is not read, so pruneInput removes it.
  const dice = (key: string, count: number): Overridable<number> => {
    const rolledValue = diceFor(seed, key).roll(count)
    const override = input.rolls[key]
    if (override === undefined || override === rolledValue) return { rolled: rolledValue }
    usedKeys.add(`roll:${key}`)
    return { rolled: rolledValue, override }
  }
  const outcomeOverride = (key: string, auto: boolean): boolean | undefined => {
    const v = input.outcomes[key]
    if (v === undefined || (v === 'pass') === auto) return undefined
    usedKeys.add(`outcome:${key}`)
    return v === 'pass'
  }

  /** Rolls 2D + characteristic DM + `extraDM` against a check. */
  const check = (key: string, label: string, target: Check, extraDM: number): Step => {
    const d = dice(key, 2)
    const dm = characteristicDM(value(target.characteristic)) + extraDM
    const total = current(d) + dm
    const auto = total >= target.target
    const ruled = outcomeOverride(key, auto)
    const passed: Overridable<boolean> = ruled === undefined ? { rolled: auto } : { rolled: auto, override: ruled }
    return {
      key,
      label,
      dice: d,
      diceCount: 2,
      dm,
      total,
      target: target.target,
      characteristic: target.characteristic,
      passed,
      result: current(passed) ? 'pass' : 'fail',
      applied: [],
      notes: [],
    }
  }

  /** Rolls `count` dice + `dm` on a table, using the nearest row when the total is outside it. */
  const tableRoll = <T extends { roll: number }>(key: string, label: string, count: number, dm: number, rows: T[]) => {
    const d = dice(key, count)
    const total = current(d) + dm
    const sorted = [...rows].sort((a, b) => a.roll - b.roll)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    let row = sorted.find((r) => r.roll === total)
    let outOfRange = false
    if (!row && first && last) {
      row = total < first.roll ? first : last
      outOfRange = true
    }
    const step: Step = { key, label, dice: d, diceCount: count, dm, total, outOfRange, result: '', applied: [], notes: [] }
    return { step, row }
  }

  const gainSkill = (skill: string, step: Step, level?: number) => {
    const before = skills[skill]
    const after = level === undefined ? (before ?? 0) + 1 : Math.max(before ?? 0, level)
    skills[skill] = after
    step.applied.push(`${skill} ${after}`)
  }

  const tableEntries = (table: SkillTableKey): string[] => {
    if (!career || !assignment) return []
    if (table === 'assignment') return assignment.skills
    return career.skillTables[table] ?? []
  }

  /** Raises a characteristic, or gains a skill, for one skill table entry. */
  const applyTableEntry = (entry: string, step: Step) => {
    const c = asCharacteristic(entry)
    if (c) {
      changes[c.characteristic] += c.change
      step.applied.push(`${c.characteristic} ${c.change >= 0 ? '+' : ''}${c.change}`)
    } else {
      gainSkill(entry, step)
    }
  }

  /** Asks which table to use, then rolls 1D on it and applies the entry. */
  const skillRoll = (key: string, termSteps: Step[]) => {
    const options = SKILL_TABLES.filter((t) => {
      if (t === 'advancedEducation') return career?.skillTables.advancedEducation !== undefined && value('EDU') >= rules.advancedEducationMinEDU
      return true
    })
    const tableKey = `${key}.table`
    const picked = choice(tableKey)
    const table = options.find((t) => t === picked)
    if (!table) throw new Stop({ kind: 'skill-table', key: tableKey, options })
    const entries = tableEntries(table)
    const { step } = tableRoll(key, `Skill roll: ${skillTableName(table)}`, 1, 0, entries.map((_, i) => ({ roll: i + 1 })))
    const entry = entries[Math.min(Math.max((step.total ?? 1) - 1, 0), entries.length - 1)] ?? ''
    step.result = entry
    termSteps.push(step)
    applyTableEntry(entry, step)
  }

  let mishapDepth = 0

  /** Applies `effects` to the character, adding to `step`. Choices are keyed under `key`. */
  const applyEffects = (effects: Effect[] | undefined, key: string, step: Step, termSteps: Step[], term: TermResult | undefined) => {
    ;(effects ?? []).forEach((effect, i) => {
      const effectKey = `${key}.effect-${i}`
      switch (effect.type) {
        case 'skill': {
          let skill = effect.options[0]
          if (effect.options.length > 1) {
            const picked = choice(`${effectKey}.skill`)
            skill = effect.options.find((o) => o === picked)
            if (skill === undefined) throw new Stop({ kind: 'skill-option', key: `${effectKey}.skill`, options: effect.options })
          }
          if (skill !== undefined) gainSkill(skill, step, effect.level)
          break
        }
        case 'roll-table': {
          const entries = tableEntries(effect.table)
          const blocked = effect.table === 'advancedEducation' && value('EDU') < rules.advancedEducationMinEDU
          if (entries.length === 0 || blocked) {
            step.notes.push(
              `Roll on ${skillTableName(effect.table)}: ${entries.length === 0 ? 'this career has no such table' : 'EDU is below the minimum for this table'}. Apply by hand.`,
            )
            break
          }
          const { step: rollStep } = tableRoll(effectKey, `Skill roll: ${skillTableName(effect.table)}`, 1, 0, entries.map((_, n) => ({ roll: n + 1 })))
          const entry = entries[Math.min(Math.max((rollStep.total ?? 1) - 1, 0), entries.length - 1)] ?? ''
          rollStep.result = entry
          termSteps.push(rollStep)
          applyTableEntry(entry, rollStep)
          break
        }
        case 'dm-next':
          nextDM[effect.roll] += effect.dm
          step.applied.push(
            effect.roll === 'qualification'
              ? `DM ${effect.dm > 0 ? '+' : ''}${effect.dm} on the next qualification roll (kept for a later career)`
              : `DM ${effect.dm > 0 ? '+' : ''}${effect.dm} on the next advancement roll`,
          )
          break
        case 'benefit-dm':
          benefitDM += effect.dm
          step.applied.push(`DM ${effect.dm > 0 ? '+' : ''}${effect.dm} on the next roll on the benefit table`)
          break
        case 'extra-benefit': {
          const count = effect.count ?? 1
          extraBenefits += count
          step.applied.push(`${count} extra benefit roll${count === 1 ? '' : 's'}`)
          break
        }
        case 'characteristic':
          changes[effect.characteristic] += effect.change
          step.applied.push(`${effect.characteristic} ${effect.change > 0 ? '+' : ''}${effect.change}`)
          break
        case 'leave-career':
          if (term) term.endReason = 'An event ends the career after this term.'
          step.applied.push('Leaves the career after this term')
          break
        case 'mishap':
          if (career && mishapDepth === 0) {
            mishapDepth += 1
            mishap(effectKey, termSteps, term, false)
            mishapDepth -= 1
          } else {
            step.notes.push('Roll another mishap. The app rolls only one extra mishap per entry; apply this one by hand.')
          }
          break
      }
    })
  }

  /** Rolls on the mishap table and applies the entry. When `endsCareer`, the career ends after the term. */
  const mishap = (key: string, termSteps: Step[], term: TermResult | undefined, endsCareer: boolean) => {
    if (!career) return
    const label = endsCareer ? 'Mishap' : term?.endReason ? 'Extra mishap' : 'Mishap (keeps the job)'
    const { step, row } = tableRoll(key, label, 1, 0, career.mishaps)
    step.result = row?.summary ?? ''
    if (row?.connection) step.connection = true
    termSteps.push(step)
    if (row && !row.effects) step.notes.push(row.summary)
    if (row) applyEffects(row.effects, key, step, termSteps, term)
    if (endsCareer && term) term.endReason = 'Survival failed, so this career ends after this term.'
  }

  /** Records the rank reached and applies its effects. */
  const reachRank = (newRank: number, termSteps: Step[], term: TermResult, key: string) => {
    rank = newRank
    const info = assignment?.ranks.find((r) => r.rank === newRank)
    title = info?.title ?? title
    term.rank = rank
    term.title = title
    const step: Step = {
      key,
      label: 'Rank',
      result: `Rank ${newRank}${info?.title ? ` ${info.title}` : ''}`,
      applied: [],
      notes: [],
    }
    if (info?.bonus && !info.effects) step.notes.push(info.bonus)
    termSteps.push(step)
    applyEffects(info?.effects, key, step, termSteps, term)
  }

  try {
    const careerId = choice('start.career')
    career = data.careers.find((c) => c.id === careerId)
    if (careerId !== undefined && !career) problems.push(`The saved career "${careerId}" isn't loaded.`)
    const assignmentId = choice('start.assignment')
    assignment = career?.assignments.find((a) => a.id === assignmentId)
    if (career && assignmentId !== undefined && !assignment) {
      problems.push(`The saved assignment "${assignmentId}" isn't part of ${career.name}.`)
    }
    if (!career || !assignment) throw new Stop({ kind: 'start', failedQualification: false })

    qualification = check('qualification', 'Qualification', career.qualification, nextDM.qualification)
    nextDM.qualification = 0
    if (!current(qualification.passed ?? { rolled: false })) throw new Stop({ kind: 'start', failedQualification: true })

    for (let n = 1; ; n += 1) {
      const termKey = `term-${n}`
      const ageStart = rules.startingAge + (n - 1) * rules.termLength
      const term: TermResult = {
        number: n,
        ageStart,
        ageEnd: ageStart + rules.termLength,
        steps: [],
        rank,
        title,
        endReason: undefined,
      }
      terms.push(term)
      const steps = term.steps

      if (n === 1) {
        const training: Step = {
          key: `${termKey}.training`,
          label: `Basic training: ${skillTableName(rules.basicTraining.table)}`,
          result: '',
          applied: [],
          notes: [],
        }
        for (const entry of tableEntries(rules.basicTraining.table)) {
          if (!asCharacteristic(entry)) gainSkill(entry, training, rules.basicTraining.level)
        }
        training.result = training.applied.join(', ')
        steps.push(training)
        reachRank(0, steps, term, `${termKey}.rank-0`)
      }

      for (let i = 0; i < rules.skillRolls.perTerm; i += 1) skillRoll(`${termKey}.skill-${i}`, steps)

      const survival = check(`${termKey}.survival`, 'Survival', assignment.survival, 0)
      steps.push(survival)
      const survived = current(survival.passed ?? { rolled: false })
      if (survived) {
        const { step, row } = tableRoll(`${termKey}.event`, 'Event', 2, 0, career.events)
        step.result = row?.summary ?? ''
        if (row?.connection) step.connection = true
        if (row && !row.effects) step.notes.push(row.summary)
        steps.push(step)
        if (row) applyEffects(row.effects, `${termKey}.event`, step, steps, term)
      } else {
        mishap(`${termKey}.mishap`, steps, term, true)
      }

      if (survived) {
        const advancement = check(`${termKey}.advancement`, 'Advancement', assignment.advancement, nextDM.advancement)
        nextDM.advancement = 0
        steps.push(advancement)
        if (current(advancement.passed ?? { rolled: false })) {
          if (assignment.ranks.some((r) => r.rank === rank + 1)) reachRank(rank + 1, steps, term, `${termKey}.rank-${rank + 1}`)
          for (let i = 0; i < rules.skillRolls.onAdvancement; i += 1) skillRoll(`${termKey}.advancement-skill-${i}`, steps)
        }
      }

      if (n >= rules.aging.fromTerm) {
        const { step, row } = tableRoll(`${termKey}.aging`, 'Aging', rules.aging.dice, rules.aging.dmPerTerm * n, rules.aging.table)
        step.result = row?.summary ?? ''
        if (row && !row.effects) step.notes.push(row.summary)
        steps.push(step)
        if (row) applyEffects(row.effects, `${termKey}.aging`, step, steps, term)
      }

      for (const step of steps) {
        if (step.connection) connections.push({ term: n, label: step.label, summary: step.result })
      }

      const nextKey = `${termKey}.next`
      const forced = term.endReason !== undefined
      const next = choice(nextKey)
      if (forced) {
        if (next !== 'muster') throw new Stop({ kind: 'next', key: nextKey, forced: true, reason: term.endReason })
        break
      }
      if (next === 'leave') break
      if (next !== 'continue') throw new Stop({ kind: 'next', key: nextKey, forced: false, reason: undefined })
    }

    const highest = <T extends { minRank: number }>(list: T[]) =>
      [...list].filter((e) => e.minRank <= rank).sort((a, b) => b.minRank - a.minRank)[0]
    const count = terms.length * rules.benefits.perTerm + (highest(rules.benefits.rankExtra)?.extra ?? 0) + extraBenefits
    benefitCount = count
    const rankDM = highest(rules.benefits.rankBenefitDM)?.dm ?? 0
    let cashRolls = 0
    for (let i = 0; i < count; i += 1) {
      const key = `benefit-${i}`
      const cashAllowed = cashRolls < rules.benefits.cashRollLimit
      const picked = choice(key)
      if (picked !== 'benefit' && !(picked === 'cash' && cashAllowed)) {
        throw new Stop({ kind: 'benefit', key, index: i, cashAllowed })
      }
      const table = picked === 'cash' ? 'cash' : 'benefit'
      if (table === 'cash') cashRolls += 1
      const dm = table === 'benefit' ? benefitDM + rankDM : 0
      if (table === 'benefit') benefitDM = 0
      const { step, row } = tableRoll(key, table === 'cash' ? 'Cash roll' : 'Benefit roll', 1, dm, career.musteringOut)
      const result: BenefitResult = {
        step,
        table,
        cash: table === 'cash' ? (row?.cash ?? 0) : 0,
        benefit: table === 'benefit' ? row?.benefit : undefined,
      }
      step.result = table === 'cash' ? `Cr${result.cash}` : (result.benefit ?? '')
      benefits.push(result)
    }
    finished = true
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    pending = error.pending
  }

  const age = terms.length === 0 ? rules.startingAge : rules.startingAge + terms.length * rules.termLength
  return {
    career,
    assignment,
    qualification,
    terms,
    skills,
    characteristicChanges: changes,
    rank,
    title,
    age,
    benefits,
    benefitCount,
    qualificationDM: nextDM.qualification,
    cash: benefits.reduce((sum, b) => sum + b.cash, 0),
    connections,
    pending,
    finished,
    usedKeys,
    problems,
  }
}

/** Returns true when a step's dice or result was overridden. */
export function stepOverridden(step: Step): boolean {
  return (step.dice !== undefined && isOverridden(step.dice)) || (step.passed !== undefined && isOverridden(step.passed))
}

/**
 * Returns a copy of `input` with every key in `choices`, `rolls` and `outcomes` that `used` does
 * not contain removed (rolls and outcomes are matched as "roll:<key>" and "outcome:<key>"), and the
 * list of removed keys. Notes are kept.
 */
export function pruneInput(input: CareerInput, used: Set<string>): { input: CareerInput; removed: string[] } {
  const removed: string[] = []
  const keep = <T>(record: Record<string, T>, prefix: string): Record<string, T> =>
    Object.fromEntries(
      Object.entries(record).filter(([k]) => {
        const ok = used.has(`${prefix}${k}`)
        if (!ok) removed.push(k)
        return ok
      }),
    )
  return {
    input: {
      choices: keep(input.choices, ''),
      rolls: keep(input.rolls, 'roll:'),
      outcomes: keep(input.outcomes, 'outcome:'),
      notes: input.notes,
    },
    removed,
  }
}
