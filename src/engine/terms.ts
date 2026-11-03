import { diceFor } from './dice'
import {
  CHARACTERISTICS,
  characteristicDM,
  normalizeCharacteristic,
  type Characteristic,
} from './characteristics'
import type { Assignment, CareerDefinition, Check, Qualification } from './career-schema'
import type { Effect, SkillTableKey } from './effects'
import { SKILL_TABLES } from './effects'
import { current, isOverridden, type Overridable } from './overridable'
import type { Rules } from './rules-schema'

/**
 * The career engine, term by term (docs/features/career-terms.md and docs/features/career-rules.md).
 * A character serves one career after another. buildCareer is a pure function: it rebuilds the whole career from the seed, the player's
 * choices and overrides, and the data. Every roll uses its own dice stream from diceFor, keyed by
 * the roll's path, so overriding one roll changes only what follows from it.
 */

/** The player's input to buildCareer. Each record is keyed by a choice or roll path. */
export interface CareerInput {
  /**
   * Decisions: "start.career", "start.assignment", "<term>.skill-<n>.table", "<term>.next", "benefit-<n>", ...
   * Keys for the second and later careers start with "career-<n>." ("career-2.start.career").
   */
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
  /**
   * Pick a career and assignment, stored under `${prefix}start.career` and `${prefix}start.assignment`.
   * `exclude` lists career ids that can't be picked (the career just left).
   */
  | { kind: 'start'; prefix: string; exclude: string[]; failedQualification: boolean }
  /**
   * Qualification failed: "draft" (roll on the Draft table, when `draftAllowed`) or "fallback" (enter
   * the career named `fallback`, when it is set).
   */
  | { kind: 'fallback'; key: string; draftAllowed: boolean; fallback: string | undefined }
  /** Pick an assignment id from `options` for a career entered through the Draft or the fallback career. */
  | { kind: 'assignment'; key: string; careerName: string; options: { id: string; name: string }[] }
  /** "try" rolls for a commission this term; "skip" rolls advancement instead. */
  | { kind: 'commission'; key: string }
  | { kind: 'skill-table'; key: string; options: SkillTableKey[] }
  | { kind: 'skill-option'; key: string; options: string[] }
  /**
   * What to do after a term. `forced` is "muster" when the career must end, "continue" when the
   * character must stay, or undefined when the player chooses; `reason` says why.
   */
  | { kind: 'next'; key: string; forced: 'muster' | 'continue' | undefined; reason: string | undefined }
  /** Benefit roll `index` (from 0) of `count` in this career: "cash" (when `cashAllowed`) or "benefit". */
  | { kind: 'benefit'; key: string; index: number; count: number; cashAllowed: boolean }
  /** Which characteristic of `options` a `reduce` effect lowers by `amount`. */
  | { kind: 'characteristic'; key: string; options: Characteristic[]; amount: number }
  /**
   * An ageing crisis took `characteristics` to 0 or below: "care" pays for medical care (`costDice` D ×
   * `costPerDie` credits), "die" ends the character.
   */
  | { kind: 'ageing-crisis'; key: string; characteristics: Characteristic[]; costDice: number; costPerDie: number }
  /** How many benefit rolls to wager on a `wager` effect: a whole number from 0 to `max`, stored as text. */
  | { kind: 'wager'; key: string; max: number; skills: string[]; target: number }

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
  /** Rules the engine applied to this step, and gains a limit stopped, described for the player. */
  reasons: string[]
}

/** One term. */
export interface TermResult {
  /** The prefix of the term's keys, e.g. "term-2" or "career-2.term-1". */
  key: string
  /** The term's number across the whole character, from 1. */
  number: number
  /** The term's number within its career, from 1. */
  careerTerm: number
  ageStart: number
  ageEnd: number
  steps: Step[]
  /** The rank at the end of the term: the officer rank when `officer` is true. */
  rank: number
  title: string | undefined
  /** True when the character is a commissioned officer at the end of the term. */
  officer: boolean
  /** Why the career ends after this term, or undefined when the player may continue. */
  endReason: string | undefined
  /** Why the character must continue after this term, or undefined when they may leave. */
  stayReason: string | undefined
  /** True when this term's aging took a characteristic to 0 or below (an ageing crisis). */
  ageingCrisis: boolean
  /** True when the character took anagathics in this term. */
  anagathics: boolean
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

/** The values of one career that change term by term. */
export interface RunState {
  terms: TermResult[]
  benefits: BenefitResult[]
  /** The enlisted rank (assignment ranks). */
  rank: number
  /** The officer rank, or undefined when the character has no commission. */
  officerRank: number | undefined
  /** The enlisted rank when the commission was gained, or undefined without a commission. */
  enlistedRankAtCommission: number | undefined
  /** The title of the highest rank reached that has one. */
  title: string | undefined
  /** Extra benefit rolls from effects and wagers in this career (may be negative after a lost wager). */
  extraBenefits: number
  /** How many mustering-out rolls the career gives, or 0 before mustering out. */
  benefitCount: number
  /** How many terms gave no benefit roll because they ended in a mishap (rules.benefits.mishapLosesTerm). */
  lostBenefitTerms: number
}

/** One career the character entered, with its terms and mustering out. */
export interface CareerRun extends RunState {
  /** 1 for the first career. */
  index: number
  /** The prefix of this career's keys: "" for the first career, "career-<n>." after. */
  prefix: string
  /** The career the qualification roll was for. */
  applied: CareerDefinition
  /** The career served: `applied`, or the Draft or fallback career. */
  career: CareerDefinition
  /** The assignment served, or undefined while it is still to be picked. */
  assignment: Assignment | undefined
  /** How the career was entered. */
  entry: 'qualified' | 'draft' | 'fallback'
  qualification: Step
  /** The Draft roll, when the character took the Draft. */
  draft: Step | undefined
}

/** The result of buildCareer. */
export interface CareerResult {
  /** Every career entered, in order. */
  runs: CareerRun[]
  /** The latest career: the last run's, or the one picked before the first qualification roll. */
  career: CareerDefinition | undefined
  assignment: Assignment | undefined
  /** The latest qualification roll. */
  qualification: Step | undefined
  /** Every term of every career. */
  terms: TermResult[]
  /** Skill levels gained, in the order first gained. */
  skills: Record<string, number>
  /** Changes to each characteristic from effects and aging. */
  characteristicChanges: Record<Characteristic, number>
  /** The last career's rank (the officer rank for an officer) and title. */
  rank: number
  title: string | undefined
  age: number
  /** Every mustering-out roll of every career. */
  benefits: BenefitResult[]
  /** The sum of each career's benefitCount. */
  benefitCount: number
  /** The sum of each career's lostBenefitTerms. */
  lostBenefitTerms: number
  /** A DM from a dm-next effect for the next career's qualification roll (used by a later career). */
  qualificationDM: number
  /** Cash from mustering out, less `costs`. Below 0 is a debt. */
  cash: number
  /** Credits spent on anagathics and on medical care after an ageing crisis. */
  costs: number
  /** True when the character died in an ageing crisis. The character is then finished. */
  dead: boolean
  connections: ConnectionOpportunity[]
  /** The next choice to make, or undefined once the character has mustered out of the last career entered. */
  pending: PendingChoice | undefined
  /** True when the character has mustered out of the last career entered. */
  finished: boolean
  /**
   * When finished, where the next career's choices go: their key `prefix`, and the career ids that
   * can't be picked (`exclude`). Picking one is optional.
   */
  nextCareer: { prefix: string; exclude: string[] } | undefined
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

/** Thrown inside buildCareer when the character dies, to end the build. */
class Died {}

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
    case 'officer':
      return 'Officer skills'
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
 * Splits a skill table entry such as "Drive or Vacc Suit" into its options, splitting on " or " only
 * outside parentheses, so "Pilot (small craft or spacecraft)" stays one entry. Returns a one-item list
 * for an entry without a choice.
 */
export function entryOptions(entry: string): string[] {
  const options: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < entry.length; i += 1) {
    const ch = entry[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && entry.startsWith(' or ', i)) {
      options.push(entry.slice(start, i).trim())
      start = i + 4
      i += 3
    }
  }
  options.push(entry.slice(start).trim())
  return options.filter((o) => o !== '')
}

/** Returns the characteristic of `check` with the highest DM for `value`, the first listed on a tie. */
function bestCharacteristic(check: Check, value: (c: Characteristic) => number): Characteristic {
  const list = typeof check.characteristic === 'string' ? [check.characteristic] : check.characteristic
  let best: Characteristic = list[0] ?? 'STR'
  for (const c of list) if (characteristicDM(value(c)) > characteristicDM(value(best))) best = c
  return best
}

/** Returns the run state of a career before its first term. */
function newRunState(): RunState {
  return {
    terms: [],
    benefits: [],
    rank: 0,
    officerRank: undefined,
    enlistedRankAtCommission: undefined,
    title: undefined,
    extraBenefits: 0,
    benefitCount: 0,
    lostBenefitTerms: 0,
  }
}

/**
 * Builds a character's careers from `seed`, the base characteristic values `base` (after the
 * player's overrides), the player's `input` and `data`. It stops at the first choice in
 * `input.choices` that is missing and returns it as `pending`. After a career musters out it reads
 * the next career's start choices; when there are none the result is `finished`, with `nextCareer`
 * set. A saved choice that names a career or assignment that isn't in `data`, or the career just
 * left, is reported in `problems` and treated as missing. It does not throw.
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
  const runs: CareerRun[] = []
  const problems: string[] = []
  let career: CareerDefinition | undefined
  let assignment: Assignment | undefined
  let rs: RunState = newRunState()
  let pending: PendingChoice | undefined
  let finished = false
  let nextCareer: CareerResult['nextCareer']
  const nextDM = { advancement: 0, qualification: 0 }
  let benefitDM = 0
  let cashRolls = 0
  let costs = 0
  let dead = false
  /** The age at death: the start of the term when the character dies before serving it. */
  let deathAge: number | undefined
  let qualificationFails = false
  let promoteThisTerm = false
  /** Terms on anagathics in a row, up to the current term. */
  let anagathicsStreak = 0
  const skillLimits = rules.skillLimits

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
  const passed = (step: Step) => current(step.passed ?? { rolled: false })

  /**
   * Rolls 2D + `dm` against `target` and returns the step, with dice and outcome overrides applied.
   * When `failOnNatural` is set, dice at or below it fail whatever the total, and the step says so.
   */
  const roll2D = (key: string, label: string, dm: number, target: number, failOnNatural?: number): Step => {
    const d = dice(key, 2)
    const total = current(d) + dm
    const naturalFail = failOnNatural !== undefined && current(d) <= failOnNatural
    const auto = total >= target && !naturalFail
    const reasons: string[] = []
    if (naturalFail && total >= target) reasons.push(`Natural ${current(d)}: ${label.toLowerCase()} fails whatever the DMs.`)
    const ruled = outcomeOverride(key, auto)
    const outcome: Overridable<boolean> = ruled === undefined ? { rolled: auto } : { rolled: auto, override: ruled }
    return {
      key,
      label,
      dice: d,
      diceCount: 2,
      dm,
      total,
      target,
      passed: outcome,
      result: current(outcome) ? 'pass' : 'fail',
      applied: [],
      notes: [],
      reasons,
    }
  }

  /** Rolls 2D + the best characteristic DM of `target` + `extraDM` against the check, as roll2D does. */
  const check = (key: string, label: string, target: Check, extraDM: number, failOnNatural?: number): Step => {
    const characteristic = bestCharacteristic(target, value)
    const step = roll2D(key, label, characteristicDM(value(characteristic)) + extraDM, target.target, failOnNatural)
    step.characteristic = characteristic
    if (typeof target.characteristic !== 'string' && target.characteristic.length > 1) {
      step.reasons.push(`Uses ${characteristic}, the best DM of ${target.characteristic.join(' or ')}.`)
    }
    return step
  }

  /**
   * Returns the option of `options` stored under `key`, the only option when there is one, or
   * undefined when there are none. When there is a choice and no stored answer matches, it throws
   * the Stop that `ask` returns.
   */
  const pickFrom = <T extends string>(key: string, options: T[], ask: () => PendingChoice): T | undefined => {
    if (options.length <= 1) return options[0]
    const answer = choice(key)
    const found = options.find((o) => o === answer)
    if (found === undefined) throw new Stop(ask())
    return found
  }

  /** Returns the skill option of `options` picked under `key` (see pickFrom), or '' when there are none. */
  const pickOption = (key: string, options: string[]): string =>
    pickFrom(key, options, () => ({ kind: 'skill-option', key, options })) ?? ''

  /**
   * Returns the benefit rolls earned so far in the current career: terms that give a benefit roll
   * times rules.benefits.perTerm, plus extra rolls from effects and wagers. Rank extras are not
   * included. Never below 0.
   */
  const earnedBenefits = () =>
    Math.max(0, Math.max(0, rs.terms.length - rs.lostBenefitTerms) * rules.benefits.perTerm + rs.extraBenefits)

  /**
   * A step that passes (or, with `auto` false, fails) without a roll, such as automatic qualification
   * or promotion, with `reason`. The outcome can still be overridden.
   */
  const automaticOutcome = (key: string, label: string, reason: string, auto = true): Step => {
    const ruled = outcomeOverride(key, auto)
    const outcome: Overridable<boolean> = ruled === undefined ? { rolled: auto } : { rolled: auto, override: ruled }
    return { key, label, passed: outcome, result: current(outcome) ? 'pass' : 'fail', applied: [], notes: [], reasons: [reason] }
  }

  /** Rolls the qualification check for `q`, or passes it without a roll when `q` makes it automatic. */
  const qualify = (key: string, q: Qualification, ageStart: number, extraDM: number): Step => {
    if (qualificationFails) return automaticOutcome(key, 'Qualification', 'Qualification fails after an ageing crisis.', false)
    if (q.automatic) return automaticOutcome(key, 'Qualification', 'Automatic qualification for this career.')
    const listed = typeof q.characteristic === 'string' ? [q.characteristic] : q.characteristic
    const high = q.automaticAt === undefined ? undefined : listed.find((c) => value(c) >= (q.automaticAt ?? 0))
    if (high !== undefined) {
      return automaticOutcome(key, 'Qualification', `Automatic qualification with ${high} ${q.automaticAt ?? 0} or higher.`)
    }
    const ageDM = q.ageDM !== undefined && ageStart >= q.ageDM.fromAge ? q.ageDM.dm : 0
    const step = check(key, 'Qualification', q, extraDM + ageDM)
    if (ageDM !== 0) step.reasons.push(`DM ${signedText(ageDM)} for age ${q.ageDM?.fromAge ?? ageStart} or more.`)
    return step
  }

  /** Rolls `count` dice for a cost of `count` D × `perDie` credits, adds it to `costs`, and returns the step. */
  const costRoll = (key: string, label: string, count: number, perDie: number): Step => {
    const d = dice(key, count)
    const amount = current(d) * perDie
    costs += amount
    return { key, label, dice: d, diceCount: count, dm: 0, total: current(d), result: `Cr${amount}`, applied: [], notes: [], reasons: [] }
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
    const step: Step = { key, label, dice: d, diceCount: count, dm, total, outOfRange, result: '', applied: [], notes: [], reasons: [] }
    return { step, row }
  }

  /**
   * Gains a level in `skill`, or raises it to at least `level`. A gain that would break a limit in
   * rules.skillLimits is lost, and the step says why.
   */
  const gainSkill = (skill: string, step: Step, level?: number) => {
    const before = skills[skill]
    const after = level === undefined ? (before ?? 0) + 1 : Math.max(before ?? 0, level)
    if (skillLimits?.maxLevel !== undefined && after > skillLimits.maxLevel) {
      step.reasons.push(`Lost: ${skill} ${after} is above the skill limit of ${skillLimits.maxLevel}.`)
      return
    }
    if (skillLimits?.totalPerIntEdu !== undefined && after > (before ?? 0)) {
      const limit = skillLimits.totalPerIntEdu * (value('INT') + value('EDU'))
      const total = Object.values(skills).reduce((sum, v) => sum + v, 0) - (before ?? 0) + after
      if (total > limit) {
        step.reasons.push(
          `Lost: ${skill} ${after} would make ${total} skill levels in total, above ${skillLimits.totalPerIntEdu} × (INT + EDU) = ${limit}.`,
        )
        return
      }
    }
    skills[skill] = after
    step.applied.push(`${skill} ${after}`)
  }

  /** Returns the entries of `table` for the current career and assignment, or [] when it has none. */
  const tableEntries = (table: SkillTableKey): string[] => {
    if (!career || !assignment) return []
    if (table === 'assignment') return assignment.skills
    return career.skillTables[table] ?? []
  }

  /** Returns why `table` can't be rolled on now, or undefined when it can. */
  const tableBlocked = (table: SkillTableKey): string | undefined => {
    if (tableEntries(table).length === 0) return 'this career has no such table'
    if (table === 'advancedEducation' && value('EDU') < rules.advancedEducationMinEDU) return 'EDU is below the minimum for this table'
    if (table === 'officer' && rs.officerRank === undefined) return 'the character is not an officer'
    return undefined
  }

  /**
   * Raises a characteristic, or gains a skill, for one skill table entry. An entry such as "Drive or
   * Vacc Suit" asks the player to pick one first, under `${step.key}.pick`. With `level`, skills are
   * raised to at least that level and characteristic entries are skipped (basic training).
   */
  const applyTableEntry = (entry: string, step: Step, level?: number, pickKey = `${step.key}.pick`) => {
    // In basic training (level set) characteristic options give nothing, so they are not offered.
    const all = entryOptions(entry)
    const options = level === undefined ? all : all.filter((o) => asCharacteristic(o) === undefined)
    if (options.length === 0) return
    const picked = pickOption(pickKey, options)
    const c = asCharacteristic(picked)
    if (c) {
      if (level !== undefined) return
      changes[c.characteristic] += c.change
      step.applied.push(`${c.characteristic} ${signedText(c.change)}`)
    } else {
      gainSkill(picked, step, level)
    }
  }

  /** Rolls 1D on `table` under `key`, adds the step to `termSteps` and applies the entry. */
  const rollOnTable = (key: string, table: SkillTableKey, termSteps: Step[]) => {
    const entries = tableEntries(table)
    const { step } = tableRoll(key, `Skill roll: ${skillTableName(table)}`, 1, 0, entries.map((_, i) => ({ roll: i + 1 })))
    const entry = entries[Math.min(Math.max((step.total ?? 1) - 1, 0), entries.length - 1)] ?? ''
    step.result = entry
    termSteps.push(step)
    applyTableEntry(entry, step)
  }

  /** Asks which table to use, then rolls 1D on it and applies the entry. */
  const skillRoll = (key: string, termSteps: Step[]) => {
    const options = SKILL_TABLES.filter((t) => t === 'assignment' || tableBlocked(t) === undefined)
    const tableKey = `${key}.table`
    const picked = choice(tableKey)
    const table = options.find((t) => t === picked)
    if (!table) throw new Stop({ kind: 'skill-table', key: tableKey, options })
    rollOnTable(key, table, termSteps)
  }

  let mishapDepth = 0

  /** Applies `effects` to the character, adding to `step`. Choices are keyed under `key`. */
  const applyEffects = (effects: Effect[] | undefined, key: string, step: Step, termSteps: Step[], term: TermResult | undefined) => {
    ;(effects ?? []).forEach((effect, i) => {
      const effectKey = `${key}.effect-${i}`
      switch (effect.type) {
        case 'skill':
          gainSkill(pickOption(`${effectKey}.skill`, effect.options), step, effect.level)
          break
        case 'roll-table': {
          const blocked = tableBlocked(effect.table)
          if (blocked !== undefined) {
            step.notes.push(`Roll on ${skillTableName(effect.table)}: ${blocked}. Apply by hand.`)
            break
          }
          rollOnTable(effectKey, effect.table, termSteps)
          break
        }
        case 'dm-next':
          nextDM[effect.roll] += effect.dm
          step.applied.push(
            effect.roll === 'qualification'
              ? `DM ${signedText(effect.dm)} on the next qualification roll (kept for a later career)`
              : `DM ${signedText(effect.dm)} on the next advancement roll`,
          )
          break
        case 'benefit-dm':
          benefitDM += effect.dm
          step.applied.push(`DM ${signedText(effect.dm)} on the next roll on the benefit table`)
          break
        case 'extra-benefit': {
          const count = effect.count ?? 1
          rs.extraBenefits += count
          step.applied.push(`${count} extra benefit roll${count === 1 ? '' : 's'}`)
          break
        }
        case 'characteristic':
          changes[effect.characteristic] += effect.change
          step.applied.push(`${effect.characteristic} ${signedText(effect.change)}`)
          break
        case 'leave-career':
          if (term) term.endReason = 'An event ends the career after this term.'
          step.applied.push('Leaves the career after this term')
          break
        case 'promote':
          promoteThisTerm = true
          step.applied.push('Automatic promotion this term')
          break
        case 'stay-in-career':
          step.applied.push('Stays in the career')
          break
        case 'wager': {
          const available = earnedBenefits()
          const max = Math.min(available, effect.maxWager ?? available)
          const wagerKey = `${effectKey}.wager`
          if (max <= 0) {
            step.applied.push('No benefit rolls to wager yet')
            break
          }
          const answer = choice(wagerKey)
          const amount = answer === undefined ? undefined : Number(answer)
          if (amount === undefined || !Number.isInteger(amount) || amount < 0 || amount > max) {
            throw new Stop({ kind: 'wager', key: wagerKey, max, skills: effect.skills, target: effect.target })
          }
          if (amount === 0) {
            step.applied.push('Wagered no benefit rolls')
            break
          }
          const skill = pickOption(`${effectKey}.skill`, effect.skills)
          // A skill check: the DM is the skill level (or -3 untrained), not a characteristic DM.
          const dm = skills[skill] ?? -3
          const roll = roll2D(effectKey, `Wager: ${skill}`, dm, effect.target)
          roll.reasons.push(`Wagered ${amount} benefit roll${amount === 1 ? '' : 's'} on ${skill} ${effect.target}+ (DM ${signedText(dm)} from the skill level).`)
          termSteps.push(roll)
          if (passed(roll)) {
            const won = Math.ceil(amount / 2)
            rs.extraBenefits += won
            roll.applied.push(`${won} extra benefit roll${won === 1 ? '' : 's'}`)
          } else {
            rs.extraBenefits -= amount
            roll.applied.push(`Lost ${amount} benefit roll${amount === 1 ? '' : 's'}`)
          }
          if (effect.gainUsedSkill) gainSkill(skill, roll)
          break
        }
        case 'keep-benefit':
          step.applied.push("Keeps this term's benefit roll")
          break
        case 'reduce': {
          const picked: Characteristic[] = []
          const amounts = effect.amounts.slice(0, effect.characteristics.length)
          amounts.forEach((amount, j) => {
            const options = effect.characteristics.filter((c) => !picked.includes(c))
            const remaining = amounts.slice(j)
            // When every amount left is the same and as many characteristics are left, each of them is reduced: no choice.
            const c =
              remaining.every((a) => a === amount) && options.length === remaining.length
                ? options[0]
                : pickFrom(`${effectKey}.pick-${j}`, options, () => ({ kind: 'characteristic', key: `${effectKey}.pick-${j}`, options, amount }))
            if (c === undefined) return
            picked.push(c)
            changes[c] -= amount
            step.applied.push(`${c} -${amount}`)
          })
          break
        }
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
    const has = (type: Effect['type']) => row?.effects?.some((e) => e.type === type) ?? false
    // The lost term is counted before the row's effects, so a wager on this row can't bet that term's roll.
    if (endsCareer && term && !has('stay-in-career')) {
      term.endReason = 'Survival failed, so this career ends after this term.'
      if (rules.benefits.mishapLosesTerm && !has('keep-benefit')) {
        rs.lostBenefitTerms += 1
        step.reasons.push('This term gives no benefit roll because it ended in a mishap.')
      }
    }
    if (row) applyEffects(row.effects, key, step, termSteps, term)
  }

  /**
   * Records `newRank` (an officer rank when the character has a commission, else an enlisted rank)
   * and applies its effects.
   */
  const reachRank = (newRank: number, termSteps: Step[], term: TermResult, key: string) => {
    const officer = rs.officerRank !== undefined
    if (officer) rs.officerRank = newRank
    else rs.rank = newRank
    const info = (officer ? career?.officerRanks : assignment?.ranks)?.find((r) => r.rank === newRank)
    rs.title = info?.title ?? rs.title
    term.rank = newRank
    term.title = rs.title
    term.officer = officer
    const step: Step = {
      key,
      label: officer ? 'Officer rank' : 'Rank',
      result: `${officer ? 'Officer rank' : 'Rank'} ${newRank}${info?.title ? ` ${info.title}` : ''}`,
      applied: [],
      notes: [],
      reasons: [],
    }
    if (info?.bonus && !info.effects) step.notes.push(info.bonus)
    termSteps.push(step)
    applyEffects(info?.effects, key, step, termSteps, term)
  }

  /**
   * Rolls aging under `key` with `dm`, adds `reasons` and the step to `steps`, and applies the row.
   * An ageing crisis marks the term;
   * with rules.aging.crisis it asks whether to pay for medical care or let the character die.
   */
  const ageing = (key: string, label: string, dm: number, reasons: string[], term: TermResult, steps: Step[], atTermStart = false) => {
    const { step, row } = tableRoll(key, label, rules.aging.dice, dm, rules.aging.table)
    step.result = row?.summary ?? ''
    step.reasons.push(...reasons)
    steps.push(step)
    if (row && !row.effects) step.notes.push(row.summary)
    const beforeAging = { ...changes }
    if (row) applyEffects(row.effects, key, step, steps, term)
    const crisis = CHARACTERISTICS.filter((c) => base[c] + changes[c] <= 0 && base[c] + beforeAging[c] > 0)
    if (crisis.length === 0) return
    term.ageingCrisis = true
    const care = rules.aging.crisis
    if (!care) {
      for (const c of crisis) step.reasons.push(`Ageing crisis: ${c} is 0 or lower. Resolve it by hand.`)
      return
    }
    const crisisKey = `${key}.crisis`
    const answer = choice(crisisKey)
    if (answer !== 'care' && answer !== 'die') {
      throw new Stop({ kind: 'ageing-crisis', key: crisisKey, characteristics: crisis, costDice: care.costDice, costPerDie: care.costPerDie })
    }
    if (answer === 'die') {
      step.reasons.push(`Ageing crisis: ${crisis.join(', ')} 0 or lower. The character dies.`)
      deathAge = atTermStart ? term.ageStart : term.ageEnd
      throw new Died()
    }
    step.reasons.push(`Ageing crisis: ${crisis.join(', ')} 0 or lower. Medical care brings them back to 1; every later qualification roll fails.`)
    steps.push(costRoll(`${key}.crisis-cost`, 'Medical care', care.costDice, care.costPerDie))
    for (const c of crisis) changes[c] = 1 - base[c]
    qualificationFails = true
  }

  for (const [key, v] of Object.entries(input.choices)) {
    if (key.endsWith('.ignore') && v === 'ignore') {
      problems.push('A saved choice ignored an aging roll. The app no longer offers that, so the roll is now applied.')
      break
    }
  }

  try {
    let previous: CareerDefinition | undefined
    for (let k = 1; ; k += 1) {
      const prefix = k === 1 ? '' : `career-${k}.`
      const exclude = previous ? [previous.id] : []
      const careerId = choice(`${prefix}start.career`)
      const named = data.careers.find((c) => c.id === careerId)
      career = named !== undefined && !exclude.includes(named.id) ? named : undefined
      if (careerId !== undefined && !named) problems.push(`The saved career "${careerId}" isn't loaded.`)
      if (named && !career) problems.push(`${named.name} is the career just left, so it can't be entered again.`)
      const assignmentId = choice(`${prefix}start.assignment`)
      assignment = career?.assignments.find((a) => a.id === assignmentId)
      if (career && assignmentId !== undefined && !assignment) {
        problems.push(`The saved assignment "${assignmentId}" isn't part of ${career.name}.`)
      }
      if (!career || !assignment) {
        if (k === 1) throw new Stop({ kind: 'start', prefix, exclude, failedQualification: false })
        finished = true
        nextCareer = { prefix, exclude }
        break
      }

      const ageNow = rules.startingAge + terms.length * rules.termLength
      const previousDM = (rules.qualification?.dmPerPreviousCareer ?? 0) * (k - 1)
      const eventDM = nextDM.qualification
      const qualification = qualify(`${prefix}qualification`, career.qualification, ageNow, eventDM + previousDM)
      nextDM.qualification = 0
      if (qualification.dice !== undefined) {
        if (previousDM !== 0) {
          qualification.reasons.push(`DM ${signedText(previousDM)} for ${k - 1} earlier career${k === 2 ? '' : 's'}.`)
        }
        if (eventDM !== 0) qualification.reasons.push(`DM ${signedText(eventDM)} from an event.`)
      }
      rs = newRunState()
      const run: CareerRun = {
        ...rs,
        index: k,
        prefix,
        applied: career,
        career,
        assignment,
        entry: 'qualified',
        qualification,
        draft: undefined,
      }
      rs = run
      runs.push(run)

      if (!passed(qualification)) {
        const fallback = data.careers.find((c) => c.id === rules.fallbackCareer)
        const draftAllowed = rules.draft !== undefined && !runs.some((r) => r.entry === 'draft')
        if (!fallback && !draftAllowed) throw new Stop({ kind: 'start', prefix, exclude, failedQualification: true })
        const fallbackKey = `${prefix}fallback`
        const picked = choice(fallbackKey)
        let entered: CareerDefinition | undefined
        let assignmentId: string | undefined
        if (picked === 'draft' && draftAllowed && rules.draft) {
          const { step, row } = tableRoll(`${prefix}draft`, 'Draft', 1, 0, rules.draft)
          run.draft = step
          run.entry = 'draft'
          entered = data.careers.find((c) => c.id === row?.career)
          step.result = entered?.name ?? row?.career ?? ''
          if (!entered) {
            problems.push(`The Draft career "${row?.career ?? ''}" isn't loaded.`)
            throw new Stop({ kind: 'start', prefix, exclude, failedQualification: true })
          }
          assignmentId = row?.assignment
        } else if (picked === 'fallback' && fallback) {
          run.entry = 'fallback'
          entered = fallback
        } else {
          throw new Stop({ kind: 'fallback', key: fallbackKey, draftAllowed, fallback: fallback?.name })
        }
        career = entered
        run.career = entered
        assignment = entered.assignments.find((a) => a.id === assignmentId)
        if (!assignment && entered.assignments.length === 1) assignment = entered.assignments[0]
        if (!assignment) {
          const key = `${prefix}assignment`
          const id = choice(key)
          assignment = entered.assignments.find((a) => a.id === id)
          if (!assignment) {
            run.assignment = undefined
            throw new Stop({
              kind: 'assignment',
              key,
              careerName: entered.name,
              options: entered.assignments.map((a) => ({ id: a.id, name: a.name })),
            })
          }
        }
        run.assignment = assignment
      }

      for (let n = 1; ; n += 1) {
        const termKey = `${prefix}term-${n}`
        const number = terms.length + 1
        const ageStart = rules.startingAge + (number - 1) * rules.termLength
        const term: TermResult = {
          key: termKey,
          number,
          careerTerm: n,
          ageStart,
          ageEnd: ageStart + rules.termLength,
          steps: [],
          rank: rs.officerRank ?? rs.rank,
          title: rs.title,
          officer: rs.officerRank !== undefined,
          endReason: undefined,
          stayReason: undefined,
          ageingCrisis: false,
          anagathics: false,
        }
        const wasOnAnagathics = terms[terms.length - 1]?.anagathics ?? false
        terms.push(term)
        rs.terms.push(term)
        const steps = term.steps

        if (n === 1) {
          const trainingTable: SkillTableKey = career.basicTraining === 'assignment' ? 'assignment' : rules.basicTraining.table
          const training: Step = {
            key: `${termKey}.training`,
            label: `Basic training: ${skillTableName(trainingTable)}${k === 1 ? '' : ' (one skill)'}`,
            result: '',
            applied: [],
            notes: [],
            reasons: [],
          }
          // The step is shown before its entries are applied, so a pick asked for here appears under it.
          steps.push(training)
          if (k === 1) {
            tableEntries(trainingTable).forEach((entry, i) => {
              applyTableEntry(entry, training, rules.basicTraining.level, `${termKey}.training.pick-${i}`)
              training.result = training.applied.join(', ')
            })
          } else {
            // A later career's basic training gives one skill from the table, picked by the player.
            const options = [
              ...new Set(tableEntries(trainingTable).flatMap((e) => entryOptions(e).filter((o) => asCharacteristic(o) === undefined))),
            ]
            if (options.length > 0) {
              gainSkill(pickOption(`${termKey}.training.pick`, options), training, rules.basicTraining.level)
              training.result = training.applied.join(', ')
            }
          }
          reachRank(0, steps, term, `${termKey}.rank-0`)
        }

        const drugs = rules.anagathics
        if (drugs) {
          if (choice(`${termKey}.anagathics`) === 'take') {
            if (wasOnAnagathics) term.anagathics = true
            else {
              const start = check(`${termKey}.anagathics`, 'Anagathics', { characteristic: drugs.characteristic, target: drugs.target }, 0)
              const natural = start.dice === undefined ? 0 : current(start.dice)
              if (drugs.prisonOnNatural !== undefined && natural <= drugs.prisonOnNatural) {
                start.notes.push(`Natural ${natural} on the anagathics roll: the book sends the character to prison. Apply by hand.`)
              }
              steps.push(start)
              term.anagathics = passed(start)
            }
            if (term.anagathics) steps.push(costRoll(`${termKey}.anagathics-cost`, 'Anagathics cost', drugs.costDice, drugs.costPerDie))
          } else if (wasOnAnagathics) {
            // The anagathics DM ends with the drugs, so this roll has only the DM for the terms served so far.
            const served = number - 1
            ageing(
              `${termKey}.anagathics-stop`,
              'Aging (stopped anagathics)',
              rules.aging.dmPerTerm * served,
              [`Stopping anagathics: aging is rolled at once, with DM ${signedText(rules.aging.dmPerTerm * served)} for ${served} term${served === 1 ? '' : 's'} served and no anagathics DM.`],
              term,
              steps,
              true,
            )
          }
        }

        anagathicsStreak = term.anagathics ? anagathicsStreak + 1 : 0

        for (let i = 0; i < rules.skillRolls.perTerm; i += 1) skillRoll(`${termKey}.skill-${i}`, steps)

        promoteThisTerm = false
        const survival = check(`${termKey}.survival`, 'Survival', assignment.survival, 0, rules.survival?.failOnNatural)
        steps.push(survival)
        let survived = passed(survival)
        if (term.anagathics) {
          const second = check(`${termKey}.survival-2`, 'Survival (anagathics)', assignment.survival, 0, rules.survival?.failOnNatural)
          second.reasons.push('Anagathics: a second survival roll this term.')
          steps.push(second)
          survived = survived && passed(second)
        }
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

        let commissioned = false
        const commission = rules.commission
        if (
          survived &&
          commission &&
          career.commission &&
          rs.officerRank === undefined &&
          !promoteThisTerm &&
          (n === 1 || value('SOC') >= commission.anyTermFromSOC)
        ) {
          const tryKey = `${termKey}.commission.try`
          const answer = choice(tryKey)
          if (answer !== 'try' && answer !== 'skip') throw new Stop({ kind: 'commission', key: tryKey })
          if (answer === 'try') {
            const laterDM = commission.dmPerLaterTerm * (n - 1)
            const step = check(`${termKey}.commission`, 'Commission', career.commission, nextDM.advancement + laterDM)
            if (laterDM !== 0) step.reasons.push(`DM ${signedText(laterDM)} for ${n - 1} term${n === 2 ? '' : 's'} after the first.`)
            if (nextDM.advancement !== 0) step.reasons.push(`DM ${signedText(nextDM.advancement)} from an event.`)
            steps.push(step)
            if (passed(step)) {
              commissioned = true
              nextDM.advancement = 0
              rs.enlistedRankAtCommission = rs.rank
              rs.officerRank = 0
              step.reasons.push('A commission replaces this term’s advancement roll.')
              reachRank(1, steps, term, `${termKey}.officer-rank-1`)
              for (let i = 0; i < rules.skillRolls.onAdvancement; i += 1) skillRoll(`${termKey}.advancement-skill-${i}`, steps)
            }
          }
        }

        if (survived && !commissioned) {
          const advancementKey = `${termKey}.advancement`
          let advancement: Step
          if (promoteThisTerm) {
            advancement = automaticOutcome(advancementKey, 'Advancement', 'Automatic promotion from an event this term.')
          } else {
            advancement = check(advancementKey, 'Advancement', assignment.advancement, nextDM.advancement)
            nextDM.advancement = 0
            const adv = rules.advancement
            const natural = advancement.dice === undefined ? 0 : current(advancement.dice)
            const total = advancement.total ?? 0
            if (adv?.stayOnNatural !== undefined && natural >= adv.stayOnNatural && term.endReason === undefined) {
              term.stayReason = `Natural ${natural} on advancement: you must continue in this career.`
              advancement.reasons.push(term.stayReason)
            } else if (adv?.leaveAtOrBelowTerms && total <= n && term.endReason === undefined) {
              term.endReason = `Advancement ${total} is at or below ${n} term${n === 1 ? '' : 's'} served, so this career ends after this term.`
              advancement.reasons.push(term.endReason)
            }
          }
          steps.push(advancement)
          if (passed(advancement)) {
            const officer = rs.officerRank !== undefined
            const nextRank = (rs.officerRank ?? rs.rank) + 1
            const ranks = officer ? career.officerRanks : assignment.ranks
            if (ranks?.some((r) => r.rank === nextRank)) {
              reachRank(nextRank, steps, term, `${termKey}.${officer ? 'officer-rank' : 'rank'}-${nextRank}`)
            }
            for (let i = 0; i < rules.skillRolls.onAdvancement; i += 1) skillRoll(`${termKey}.advancement-skill-${i}`, steps)
          }
        }

        if (number >= rules.aging.fromTerm) {
          // Anagathics add the number of terms taken in a row, up to this one, to the aging roll.
          const streak = anagathicsStreak
          const reasons = streak > 0 ? [`DM +${streak} from ${streak} term${streak === 1 ? '' : 's'} on anagathics.`] : []
          ageing(`${termKey}.aging`, 'Aging', rules.aging.dmPerTerm * number + streak, reasons, term, steps)
        }

        const nextKey = `${termKey}.next`
        const next = choice(nextKey)
        if (term.endReason !== undefined) {
          if (next !== 'muster') throw new Stop({ kind: 'next', key: nextKey, forced: 'muster', reason: term.endReason })
          break
        }
        if (term.stayReason !== undefined) {
          if (next !== 'continue') throw new Stop({ kind: 'next', key: nextKey, forced: 'continue', reason: term.stayReason })
          continue
        }
        if (next === 'leave') break
        if (next !== 'continue') throw new Stop({ kind: 'next', key: nextKey, forced: undefined, reason: undefined })
      }

      // For benefits, an officer's rank is the officer rank plus the enlisted rank held when commissioned.
      const benefitRank = rs.officerRank === undefined ? rs.rank : rs.officerRank + (rs.enlistedRankAtCommission ?? 0)
      const highest = <T extends { minRank: number }>(list: T[]) =>
        [...list].filter((e) => e.minRank <= benefitRank).sort((a, b) => b.minRank - a.minRank)[0]
      const count = earnedBenefits() + (highest(rules.benefits.rankExtra)?.extra ?? 0)
      rs.benefitCount = count
      const rankDM = highest(rules.benefits.rankBenefitDM)?.dm ?? 0
      const cashSkill = rules.benefits.cashSkillDM
      const cashSkillDM = cashSkill !== undefined && skills[cashSkill.skill] !== undefined ? cashSkill.dm : 0
      for (let i = 0; i < count; i += 1) {
        const key = `${prefix}benefit-${i}`
        const cashAllowed = cashRolls < rules.benefits.cashRollLimit
        const picked = choice(key)
        if (picked !== 'benefit' && !(picked === 'cash' && cashAllowed)) {
          throw new Stop({ kind: 'benefit', key, index: i, count, cashAllowed })
        }
        const table = picked === 'cash' ? 'cash' : 'benefit'
        if (table === 'cash') cashRolls += 1
        const dm = table === 'benefit' ? benefitDM + rankDM : rankDM + cashSkillDM
        const eventDM = table === 'benefit' ? benefitDM : 0
        if (table === 'benefit') benefitDM = 0
        const { step, row } = tableRoll(key, table === 'cash' ? 'Cash roll' : 'Benefit roll', 1, dm, career.musteringOut)
        if (rankDM !== 0) step.reasons.push(`DM ${signedText(rankDM)} from rank ${benefitRank}.`)
        if (eventDM !== 0) step.reasons.push(`DM ${signedText(eventDM)} from an event.`)
        if (table === 'cash' && cashSkillDM !== 0 && cashSkill) step.reasons.push(`DM ${signedText(cashSkillDM)} from ${cashSkill.skill}.`)
        const result: BenefitResult = {
          step,
          table,
          cash: table === 'cash' ? (row?.cash ?? 0) : 0,
          benefit: table === 'benefit' ? row?.benefit : undefined,
        }
        step.result = table === 'cash' ? `Cr${result.cash}` : (result.benefit ?? '')
        rs.benefits.push(result)
      }
      previous = career
    }
  } catch (error) {
    if (error instanceof Died) {
      dead = true
      finished = true
    } else if (error instanceof Stop) {
      pending = error.pending
    } else {
      throw error
    }
  }

  // Connections come from every term built, so a term that ends in death or a pending choice keeps its own.
  const connections: ConnectionOpportunity[] = terms.flatMap((t) =>
    t.steps.flatMap((step) => (step.connection ? [{ term: t.number, label: step.label, summary: step.result }] : [])),
  )
  const last = runs[runs.length - 1]
  const benefits = runs.flatMap((r) => r.benefits)
  const sum = (f: (r: CareerRun) => number) => runs.reduce((total, r) => total + f(r), 0)
  return {
    runs,
    career: last && finished ? last.career : (career ?? last?.career),
    assignment: last && finished ? last.assignment : assignment,
    qualification: last?.qualification,
    terms,
    skills,
    characteristicChanges: changes,
    rank: last ? (last.officerRank ?? last.rank) : 0,
    title: last?.title,
    age: deathAge ?? rules.startingAge + terms.length * rules.termLength,
    benefits,
    benefitCount: sum((r) => r.benefitCount),
    lostBenefitTerms: sum((r) => r.lostBenefitTerms),
    qualificationDM: nextDM.qualification,
    cash: benefits.reduce((total, b) => total + b.cash, 0) - costs,
    costs,
    dead,
    connections,
    pending,
    finished,
    nextCareer,
    usedKeys,
    problems,
  }
}

/** Returns `n` as text with its sign: "+1", "-2", "+0". */
function signedText(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`
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

/** What removeLastTerm returns: the new input, and the number of the term it removed (from 1). */
export interface TermRemoval {
  input: CareerInput
  removed: number
}

/** Matches a term notes key ("term-3") and captures the term number. */
const NOTES_KEY = /^term-(\d+)$/

/**
 * Removes the most recent term of the career built from `seed`, `base`, `input` and `data`, and
 * returns the new input with the removed term's number, or undefined when that career has no terms.
 * `built` is the career already built from the same arguments, when the caller has it; otherwise it
 * is built here. The term before the removed one, when there is one, loses its after-term choice
 * ("<term>.next"), so the rebuilt career stops at the end of that term with the after-term choice
 * pending. Every choice, roll override and outcome override the rebuilt career no longer reads is
 * then removed with pruneInput: the removed term's own keys, and any mustering out and later careers
 * that followed it. When the removed term is the character's first, every choice and override is
 * removed, so the career pick is pending again. Notes for the removed term and for every later term
 * number (left by terms an earlier change dropped) are removed; notes for earlier terms are kept.
 */
export function removeLastTerm(
  seed: string,
  base: Record<Characteristic, number>,
  input: CareerInput,
  data: CareerData,
  built: CareerResult = buildCareer(seed, base, input, data),
): TermRemoval | undefined {
  const { terms } = built
  const last = terms[terms.length - 1]
  if (!last) return undefined
  const previous = terms[terms.length - 2]
  const notes = Object.fromEntries(
    Object.entries(input.notes).filter(([k]) => {
      const match = NOTES_KEY.exec(k)
      return match === null || Number(match[1]) < last.number
    }),
  )
  if (!previous) return { input: { ...EMPTY_INPUT, notes }, removed: last.number }
  const choices = Object.fromEntries(Object.entries(input.choices).filter(([k]) => k !== `${previous.key}.next`))
  const trimmed: CareerInput = { ...input, choices, notes }
  return { input: pruneInput(trimmed, buildCareer(seed, base, trimmed, data).usedKeys).input, removed: last.number }
}
