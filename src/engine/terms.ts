import { diceFor } from './dice'
import {
  CHARACTERISTICS,
  CHECK_CHARACTERISTICS,
  characteristicDM,
  normalizeCharacteristic,
  type Characteristic,
  type CheckCharacteristic,
} from './characteristics'
import type { Assignment, CareerDefinition, Check, Qualification } from './career-schema'
import type { EducationDefinition } from './education-schema'
import type { Effect, RollKind, SkillTableKey } from './effects'
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

/** An education entry offered at a career pick: its id and name. */
export interface EducationOption {
  id: string
  name: string
}

/** The choice buildCareer needs next, with the key to store the answer under in CareerInput.choices. */
export type PendingChoice =
  /**
   * Pick a career and assignment, stored under `${prefix}start.career` and `${prefix}start.assignment`.
   * `exclude` lists career ids that can't be picked (the career just left). `education` lists the education
   * entries that can be picked instead, stored as "education:<id>" under `${prefix}start.career`.
   */
  | { kind: 'start'; prefix: string; exclude: string[]; failedQualification: boolean; education: EducationOption[] }
  /**
   * Qualification failed: "draft" (roll on the Draft table, when `draftAllowed`) or "fallback" (enter
   * the career named `fallback`, when it is set).
   */
  | { kind: 'fallback'; key: string; draftAllowed: boolean; fallback: string | undefined }
  /**
   * Pick an assignment id from `options` for a career entered through the Draft, the fallback career or an
   * event, or at the start of a term in a career with `assignmentEachTerm`. `keep` is the current assignment's
   * id for the latter (the one Finish career keeps), undefined otherwise.
   */
  | { kind: 'assignment'; key: string; careerName: string; options: { id: string; name: string }[]; keep: string | undefined }
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
   * Which option of a `choice` effect to take, stored as the option's label. `source` names the step
   * that offers it ("Event", "Mishap") and `summary` is that step's entry summary.
   */
  | { kind: 'event-choice'; key: string; source: string; summary: string; options: string[] }
  /** Which talent of `options` (the listed talents not yet held or tried) to roll for next, stored as its name. */
  | { kind: 'talent'; key: string; options: string[] }

/**
 * A DM from a `dm-later` effect, which the player applies by hand to one later roll. The roll picked
 * is stored in CareerInput.choices under `key` as the roll's step key.
 */
export interface LaterDM {
  /** The choice key that holds the step key of the roll it applies to. */
  key: string
  dm: number
  /** The roll kinds it may be applied to, or undefined for any kind in ROLL_KINDS. */
  rolls: RollKind[] | undefined
  /** Where it came from, as shown to the player, e.g. "Term 2 Event". */
  source: string
  /** The step key of the roll it was applied to, or undefined while it is not applied. */
  appliedTo: string | undefined
  /**
   * The rolls built after it that it can be applied to, in the order they were rolled, with the label
   * shown to the player ("Term 3 Advancement"). Includes the roll it was applied to.
   */
  targets: { key: string; label: string }[]
}

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
  characteristic?: CheckCharacteristic
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
  /** DMs from `dm-later` effects on this step, which the player applies to a later roll. */
  later?: LaterDM[]
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
  /** For an education term, the education entry's name. Undefined for a career term. */
  education?: string
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
  /** The current Parole Threshold in a career with `parole`, or undefined before it is rolled and in other careers. */
  parole: number | undefined
}

/**
 * One pre-career education attempt (docs/features/education.md): the entry roll, and the term when entry
 * passed. `order` is its place among careers and education attempts, from 1, the same count that names
 * their keys (`prefix`). `outcome` is undefined while the term is still being played.
 */
export interface EducationRecord {
  order: number
  prefix: string
  /** The term number the attempt was made for, from 1. */
  number: number
  education: EducationDefinition
  entry: Step
  /** The education term, or undefined when entry failed (the term is not counted). */
  term: TermResult | undefined
  outcome: 'failed-entry' | 'graduated' | 'honours' | 'failed' | undefined
  /** The bonuses graduation gives the next career, described for the player. */
  bonuses: string[]
}

/** One career the character entered, with its terms and mustering out. */
export interface CareerRun extends RunState {
  /** 1 for the first career. Education attempts are not counted. */
  index: number
  /** Its place among careers and education attempts, from 1 (see EducationRecord.order). */
  order: number
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
  /** True when a `next-career` effect sent the character to this career or the Draft, with no qualification roll. */
  forced: boolean
  qualification: Step
  /** The Draft roll, when the character took the Draft. */
  draft: Step | undefined
}

/** The result of buildCareer. */
export interface CareerResult {
  /** Every career entered, in order. */
  runs: CareerRun[]
  /** Every education attempt, in order. */
  educations: EducationRecord[]
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
  /**
   * `dm-next` advancement and survival DMs not used yet when the build ended (0 when none). A later
   * career's first roll of that kind uses them.
   */
  unusedNextDMs: { advancement: number; survival: number }
  /** Every DM from a `dm-later` effect, in the order gained, applied or not. */
  laterDMs: LaterDM[]
  /** Cash from mustering out, less `costs`. Below 0 is a debt. */
  cash: number
  /** Ship shares gained from `ship-shares` effects. Ship shares named only in a benefit's text are not counted. */
  shipShares: number
  /** The character's PSI after changes, or undefined when no `psi-test` effect has tested it. */
  psi: number | undefined
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
  nextCareer: { prefix: string; exclude: string[]; education: EducationOption[] } | undefined
  /** The keys of `choices`, `rolls` and `outcomes` that this build read. Others no longer apply. */
  usedKeys: Set<string>
  /** Saved choices that name a career or assignment that isn't loaded. */
  problems: string[]
}

/** The data buildCareer reads: the careers to choose from, the rules values, and the education entries (none when left out). */
export interface CareerData {
  careers: CareerDefinition[]
  rules: Rules
  education?: EducationDefinition[]
}

/**
 * Effects that change the current career (its skill tables, benefit rolls, rank or the end of the term),
 * which an education term has none of: in an education term they are notes.
 */
const CAREER_ONLY_EFFECTS: readonly Effect['type'][] = [
  'roll-table',
  'extra-benefit',
  'leave-career',
  'mishap',
  'promote',
  'stay-in-career',
  'keep-benefit',
  'wager',
]

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
 * Reads a skill table entry that changes a characteristic or PSI: a characteristic name alone ("DEX"), which
 * means +1, or a name followed by a signed whole number ("DEX +1", "SOC -1"). Returns the
 * characteristic and the change, or undefined when the entry is anything else (a skill).
 */
export function asCharacteristic(entry: string): { characteristic: CheckCharacteristic; change: number } | undefined {
  const match = /^([A-Z]{3})(?:\s*([+-]\d+))?$/.exec(entry.trim())
  if (!match) return undefined
  const characteristic = CHECK_CHARACTERISTICS.find((c) => c === match[1])
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
function bestCharacteristic(check: Check, value: (c: CheckCharacteristic) => number): CheckCharacteristic {
  const list = typeof check.characteristic === 'string' ? [check.characteristic] : check.characteristic
  let best: CheckCharacteristic = list[0] ?? 'STR'
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
    parole: undefined,
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
  const nextDM = { advancement: 0, qualification: 0, survival: 0 }
  let benefitDM = 0
  let cashRolls = 0
  let costs = 0
  /** PSI after the `psi-test` roll and later changes (never below 0), or undefined before a test. */
  let psi: number | undefined
  /** Talent rolls made so far, for the `attemptDM` of the next one. */
  let talentRolls = 0
  /** The talents rolled for so far, by name; term 1 of a career with `talents` rolls only the others. */
  const talentsRolled = new Set<string>()
  /** Talent rolls made from skill gains on each step, by step key, so each roll has its own key. */
  const talentRollsOnStep = new Map<string, number>()
  /** The steps of the career term being played, or undefined outside one (talent rolls from skill gains go here). */
  let currentSteps: Step[] | undefined
  /** True during basic training, where a talent the character lacks is not gained. */
  let inBasicTraining = false
  let dead = false
  /** The age at death: the start of the term when the character dies before serving it. */
  let deathAge: number | undefined
  let qualificationFails = false
  let promoteThisTerm = false
  /**
   * The next career set by a `next-career` effect: a loaded career, or the Draft. The next career start
   * reads it and clears it.
   */
  let forcedNext: { kind: 'career'; career: CareerDefinition } | { kind: 'draft' } | undefined
  /** Terms on anagathics in a row, up to the current term. */
  let anagathicsStreak = 0
  const educations: EducationRecord[] = []
  /** True once the character has graduated from an education entry; there is one graduation per character. */
  let graduated = false
  /** While an education term's effects are applied: whether an event failed graduation. */
  let educationState: { failedGraduation: boolean } | undefined
  /** True while an education term is played, so effects that need a career become notes. */
  let inEducation = false
  /**
   * What graduation gives the next career, which the next career start reads and clears: a qualification
   * DM and a commission roll for the listed careers, and the academy's tie to a career.
   */
  let educationBonus:
    | {
        school: string
        qualificationDM: { careers: string[]; dm: number } | undefined
        commission: { careers: string[]; dm: number; automatic: boolean } | undefined
        /** `commission` is false when graduation failed: the tied career then has no commission roll in its first term. */
        tied: { career: string; serviceSkills: number; commission: boolean } | undefined
      }
    | undefined
  const skillLimits = rules.skillLimits

  /** The current value of `c`. PSI is 0 until a `psi-test` effect tests it. */
  const value = (c: CheckCharacteristic) =>
    c === 'PSI' ? (psi ?? 0) : (normalizeCharacteristic(base[c] + changes[c]) ?? 0)

  /**
   * Adds `change` to `c` and lists it on `step`. PSI never goes below 0, and before a PSI test a PSI change is
   * a note on `step` and changes nothing.
   */
  const changeCharacteristic = (c: CheckCharacteristic, change: number, step: Step) => {
    if (c === 'PSI') {
      if (psi === undefined) {
        step.notes.push(`PSI ${signedText(change)} changes nothing: the character's PSI hasn't been tested.`)
        return
      }
      psi = Math.max(0, psi + change)
    } else {
      changes[c] += change
    }
    step.applied.push(`${c} ${signedText(change)}`)
  }
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

  /** Every roll a `dm-later` DM can be applied to, in the order rolled, with its label and kind. */
  const rollLog: { key: string; label: string; kind: RollKind }[] = []
  /** Every `dm-later` DM gained, with the length of rollLog when it was gained. */
  const later: { dm: LaterDM; from: number }[] = []
  /**
   * Records the roll `key` (shown as `label`) of `kind` as one a later DM can be applied to, and returns
   * the sum of the later DMs the player applied to it, with one reason for each. Reads a DM's choice
   * only when it names this roll, so a choice whose roll is no longer built is pruned.
   */
  const laterDMFor = (key: string, kind: RollKind, label: string): { dm: number; reasons: string[] } => {
    rollLog.push({ key, label, kind })
    let dm = 0
    const reasons: string[] = []
    for (const { dm: held } of later) {
      if (held.appliedTo !== undefined || input.choices[held.key] !== key) continue
      if (held.rolls !== undefined && !held.rolls.includes(kind)) continue
      choice(held.key)
      held.appliedTo = key
      dm += held.dm
      reasons.push(`DM ${signedText(held.dm)} from ${held.source}, applied by the player.`)
    }
    return { dm, reasons }
  }

  /**
   * Returns the DMs for the roll `key` (shown as `label`) of `kind` that come from events: the `dm-next`
   * DM for `next` when given, which is then used up, and the `dm-later` DMs the player applied to it
   * (see laterDMFor). Returns their sum and one reason for each.
   */
  const rollDMs = (key: string, kind: RollKind, label: string, next?: keyof typeof nextDM): { dm: number; reasons: string[] } => {
    const eventDM = next === undefined ? 0 : nextDM[next]
    if (next !== undefined) nextDM[next] = 0
    const held = laterDMFor(key, kind, label)
    const reasons = eventDM === 0 ? held.reasons : [`DM ${signedText(eventDM)} from an event.`, ...held.reasons]
    return { dm: eventDM + held.dm, reasons }
  }

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
  const qualify = (key: string, label: string, q: Qualification, ageStart: number, extraDM: number): Step => {
    if (qualificationFails) return automaticOutcome(key, 'Qualification', 'Qualification fails after an ageing crisis.', false)
    if (q.automatic) return automaticOutcome(key, 'Qualification', 'Automatic qualification for this career.')
    const listed = typeof q.characteristic === 'string' ? [q.characteristic] : q.characteristic
    const high = q.automaticAt === undefined ? undefined : listed.find((c) => value(c) >= (q.automaticAt ?? 0))
    if (high !== undefined) {
      return automaticOutcome(key, 'Qualification', `Automatic qualification with ${high} ${q.automaticAt ?? 0} or higher.`)
    }
    const ageDM = q.ageDM !== undefined && ageStart >= q.ageDM.fromAge ? q.ageDM.dm : 0
    const held = rollDMs(key, 'qualification', `${label} Qualification`)
    const step = check(key, 'Qualification', q, extraDM + ageDM + held.dm)
    if (ageDM !== 0) step.reasons.push(`DM ${signedText(ageDM)} for age ${q.ageDM?.fromAge ?? ageStart} or more.`)
    step.reasons.push(...held.reasons)
    return step
  }

  /**
   * Rolls the current career's Parole Threshold at `key` (its `parole` dice + `plus`, capped at `max`), sets
   * rs.parole and returns the step. Returns undefined, and changes nothing, for a career without `parole`.
   */
  const rollParole = (key: string, label = 'Parole Threshold'): Step | undefined => {
    const p = career?.parole
    if (!p) return undefined
    const step = diceStep(key, label, p.dice, p.plus)
    const raw = step.total ?? 0
    rs.parole = Math.min(raw, p.max)
    step.result = String(rs.parole)
    if (raw > p.max) step.reasons.push(`The Parole Threshold is capped at ${p.max}.`)
    return step
  }

  /**
   * Rolls `count` dice + `dm` at `key` with no target and returns the step labelled `label`, with its total
   * as the result; the caller may replace the result.
   */
  const diceStep = (key: string, label: string, count: number, dm: number): Step => {
    const d = dice(key, count)
    const total = current(d) + dm
    return { key, label, dice: d, diceCount: count, dm, total, result: String(total), applied: [], notes: [], reasons: [] }
  }

  /** Rolls `count` dice for a cost of `count` D × `perDie` credits, adds it to `costs`, and returns the step. */
  const costRoll = (key: string, label: string, count: number, perDie: number): Step => {
    const step = diceStep(key, label, count, 0)
    const amount = (step.total ?? 0) * perDie
    costs += amount
    step.result = `Cr${amount}`
    return step
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
   * Rolls for `talent` of the current career's `talents` at `key`: 2D + the PSI DM + its `dm` + `attemptDM`
   * for each talent roll before it, against `target`. Counts the roll and returns the step.
   */
  const talentRoll = (key: string, talent: { name: string; dm: number }): Step => {
    const talentRules = career?.talents
    const attemptDM = (talentRules?.attemptDM ?? 0) * talentRolls
    const step = roll2D(key, `Talent: ${talent.name}`, characteristicDM(value('PSI')) + talent.dm + attemptDM, talentRules?.target ?? 0)
    step.characteristic = 'PSI'
    if (talent.dm !== 0) step.reasons.push(`DM ${signedText(talent.dm)} for ${talent.name}.`)
    if (attemptDM !== 0) step.reasons.push(`DM ${signedText(attemptDM)} for ${talentRolls} earlier talent roll${talentRolls === 1 ? '' : 's'}.`)
    talentRolls += 1
    talentsRolled.add(talent.name)
    return step
  }

  /**
   * Gains a level in `skill`, or raises it to at least `level`. A gain that would break a limit in
   * rules.skillLimits is lost, and the step says why. In a career term with `talents`, a listed talent the
   * character lacks first needs a talent roll at `<step key>.talent-<n>` (added to the term), unless
   * `talentRolled` says the caller has made it; on a fail nothing is gained. In basic training such a talent
   * is not gained.
   */
  const gainSkill = (skill: string, step: Step, level?: number, talentRolled = false) => {
    // In a career with talents, gaining a talent the character lacks needs a talent roll first.
    const termSteps = currentSteps
    const talent = talentRolled || !termSteps ? undefined : career?.talents?.list.find((t) => t.name === skill)
    if (talent && termSteps && skills[skill] === undefined) {
      if (inBasicTraining) {
        step.reasons.push(`No ${skill}: in basic training a talent comes only from its talent roll.`)
        return
      }
      const n = talentRollsOnStep.get(step.key) ?? 0
      talentRollsOnStep.set(step.key, n + 1)
      const roll = talentRoll(`${step.key}.talent-${n}`, talent)
      termSteps.push(roll)
      if (!passed(roll)) {
        step.reasons.push(`No ${skill}: its talent roll failed.`)
        return
      }
    }
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
      changeCharacteristic(c.characteristic, c.change, step)
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

  /**
   * Shows a rolled table row on `step`: sets the result to the row's summary, marks a connection,
   * notes the summary when the row has no effects (and `noteSummary` is not false), adds the step to
   * `termSteps` and applies the row's effects under `key`. Does nothing more when `row` is undefined.
   */
  const showRow = (
    step: Step,
    row: { summary: string; connection?: boolean | undefined; effects?: Effect[] | undefined } | undefined,
    key: string,
    termSteps: Step[],
    term: TermResult | undefined,
    noteSummary = true,
  ) => {
    step.result = row?.summary ?? ''
    if (row?.connection) step.connection = true
    if (row && !row.effects && noteSummary) step.notes.push(row.summary)
    termSteps.push(step)
    if (row) applyEffects(row.effects, key, step, termSteps, term)
  }

  let shipShares = 0
  let lifeEventDepth = 0
  /**
   * Rolls on rules.lifeEvents under `key` and adds the step after the step that gave it, then rolls the
   * entry's 1D sub-table when it has one, and applies the effects of each. A `life-event` effect inside a
   * Life Event is a note, so one entry rolls the table at most once. The Life Event's effects run outside
   * any mishap, so a `stay-in-career` or `keep-benefit` effect on a Life Events entry can't undo a mishap.
   */
  const lifeEvent = (key: string, from: Step, termSteps: Step[], term: TermResult | undefined) => {
    const table = rules.lifeEvents
    if (!table) {
      from.notes.push('Roll on the Life Events table by hand: the rules have no Life Events table.')
      return
    }
    if (lifeEventDepth > 0) {
      from.notes.push('Roll another Life Event by hand. The app rolls one Life Event per entry.')
      return
    }
    const outerMishap = mishapState
    mishapState = undefined
    lifeEventDepth += 1
    try {
      const { step, row } = tableRoll(key, 'Life Event', table.dice, 0, table.table)
      showRow(step, row, key, termSteps, term, !row?.subTable)
      if (row?.subTable) {
        const sub = tableRoll(`${key}.sub`, `Life Event: ${row.summary}`, 1, 0, row.subTable)
        showRow(sub.step, sub.row, `${key}.sub`, termSteps, term)
      }
    } finally {
      lifeEventDepth -= 1
      mishapState = outerMishap
    }
  }

  let mishapDepth = 0
  /**
   * While a mishap's effects are applied: whether it ended the career and whether it cost the term's
   * benefit roll, so a `stay-in-career` or `keep-benefit` effect picked in a choice can undo either.
   */
  let mishapState: { endedCareer: boolean; lostTerm: boolean } | undefined
  /** Gives back the benefit roll the current mishap took, if it took one, and removes the reason from `step`. */
  const restoreMishapTerm = (step: Step) => {
    if (!mishapState?.lostTerm) return
    rs.lostBenefitTerms -= 1
    mishapState.lostTerm = false
    const at = step.reasons.indexOf(LOST_TERM_REASON)
    if (at >= 0) step.reasons.splice(at, 1)
  }

  /** Applies `effects` to the character, adding to `step`. Choices are keyed under `key`. */
  const applyEffects = (effects: Effect[] | undefined, key: string, step: Step, termSteps: Step[], term: TermResult | undefined) => {
    ;(effects ?? []).forEach((effect, i) => {
      const effectKey = `${key}.effect-${i}`
      if (inEducation && CAREER_ONLY_EFFECTS.includes(effect.type)) {
        step.notes.push(`Apply "${effect.type}" by hand: it needs a career, and this is an education term.`)
        return
      }
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
              : `DM ${signedText(effect.dm)} on the next ${effect.roll} roll`,
          )
          break
        case 'dm-later': {
          const held: LaterDM = {
            key: `${effectKey}.apply`,
            dm: effect.dm,
            rolls: effect.rolls,
            source: term ? `Term ${term.number} ${step.label}` : step.label,
            appliedTo: undefined,
            targets: [],
          }
          later.push({ dm: held, from: rollLog.length })
          step.later = [...(step.later ?? []), held]
          step.applied.push(`DM ${signedText(effect.dm)} to hold for ${laterRollsText(effect.rolls)} (pick the roll)`)
          break
        }
        case 'choice': {
          const labels = effect.options.map((o) => o.label)
          const choiceKey = `${effectKey}.choice`
          const picked = pickFrom(choiceKey, labels, () => ({
            kind: 'event-choice',
            key: choiceKey,
            source: step.label,
            summary: step.result,
            options: labels,
          }))
          const index = effect.options.findIndex((o) => o.label === picked)
          const option = effect.options[index]
          if (!option) break
          step.applied.push(`Chose: ${option.label}`)
          applyEffects(option.effects, `${effectKey}.option-${index}`, step, termSteps, term)
          break
        }
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
          changeCharacteristic(effect.characteristic, effect.change, step)
          break
        case 'psi-test': {
          if (psi !== undefined) {
            step.notes.push(`The character's PSI is already tested (PSI ${value('PSI')}), so this changes nothing.`)
            break
          }
          // Terms finished before the current one, education terms included.
          const served = term ? term.number - 1 : terms.length
          const test = diceStep(`${effectKey}.psi`, 'PSI test', 2, -served)
          psi = Math.max(0, test.total ?? 0)
          test.result = `PSI ${psi}`
          if (served > 0) test.reasons.push(`DM -${served} for ${served} term${served === 1 ? '' : 's'} served.`)
          if ((test.total ?? 0) < 0) test.reasons.push('PSI is never below 0.')
          termSteps.push(test)
          step.applied.push(`PSI tested: ${psi}`)
          break
        }
        case 'leave-career':
          if (term) term.endReason = 'An event ends the career after this term.'
          step.applied.push('Leaves the career after this term')
          break
        case 'promote':
          promoteThisTerm = true
          step.applied.push('Automatic promotion this term')
          break
        case 'stay-in-career':
          // Inside a choice the mishap has already ended the career and taken the benefit roll, so
          // picking this option undoes both, as a stay-in-career outside a choice would.
          if (mishapState?.endedCareer && term && term.endReason === MISHAP_END_REASON) term.endReason = undefined
          if (mishapState) mishapState.endedCareer = false
          restoreMishapTerm(step)
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
        case 'fail-graduation':
          if (educationState) {
            educationState.failedGraduation = true
            step.applied.push('Fails graduation')
          } else {
            step.notes.push('Fails graduation: this applies only in an education term, so nothing changes here.')
          }
          break
        case 'next-career': {
          if (!term) {
            step.notes.push('Take the next career this names by hand: it applies only inside a career term.')
            break
          }
          if (effect.career === 'draft') {
            if (!rules.draft) {
              step.notes.push('Take the Draft next term by hand: the rules have no Draft table.')
              break
            }
            forcedNext = { kind: 'draft' }
            term.endReason = 'An event sends the character to the Draft, so this career ends after this term.'
            step.applied.push('The Draft next term')
            break
          }
          const target = data.careers.find((c) => c.id === effect.career)
          if (!target) {
            step.notes.push(`Take the career "${effect.career}" next term by hand: no loaded career pack has it.`)
            break
          }
          if (target.id === career?.id) {
            step.notes.push(`The character is already in ${target.name}, so this changes nothing.`)
            break
          }
          forcedNext = { kind: 'career', career: target }
          term.endReason = `An event sends the character to ${target.name}, so this career ends after this term.`
          step.applied.push(`${target.name} next term`)
          break
        }
        case 'parole':
        case 'parole-reroll':
        case 'parole-lower-dice': {
          const p = career?.parole
          if (!p || rs.parole === undefined) {
            step.notes.push('Change the Parole Threshold by hand: the character has no Parole Threshold in this career.')
            break
          }
          if (effect.type === 'parole') {
            rs.parole = Math.min(p.max, rs.parole + effect.change)
            step.applied.push(`Parole Threshold ${signedText(effect.change)} (now ${rs.parole})`)
          } else if (effect.type === 'parole-reroll') {
            const rolled = rollParole(`${effectKey}.parole`, 'Parole Threshold (rolled again)')
            if (rolled) termSteps.push(rolled)
            step.applied.push(`Parole Threshold rolled again (now ${rs.parole})`)
          } else {
            const lowered = diceStep(`${effectKey}.parole`, 'Parole Threshold (lowered)', effect.dice, 0)
            const by = lowered.total ?? 0
            rs.parole -= by
            lowered.result = `-${by} (now ${rs.parole})`
            termSteps.push(lowered)
            step.applied.push(`Parole Threshold -${effect.dice}D (now ${rs.parole})`)
          }
          break
        }
        case 'check': {
          const option = pickOption(`${effectKey}.check-option`, effect.options)
          const characteristic = CHECK_CHARACTERISTICS.find((c) => c === option)
          // A characteristic check uses the characteristic DM; a skill check uses the skill level, or -3 untrained.
          const dm = characteristic ? characteristicDM(value(characteristic)) : (skills[option] ?? -3)
          const roll = roll2D(`${effectKey}.check`, `Check: ${option}`, dm, effect.target)
          roll.reasons.push(`${option} ${effect.target}+, DM ${signedText(dm)} from ${characteristic ? 'the characteristic' : 'the skill level'}.`)
          termSteps.push(roll)
          // Each outcome has its own key prefix, so a pick saved under one is never read by the other.
          const outcome = passed(roll) ? 'pass' : 'fail'
          applyEffects(outcome === 'pass' ? effect.pass : effect.fail, `${effectKey}.check.${outcome}`, roll, termSteps, term)
          break
        }
        case 'keep-benefit':
          // Inside a choice the mishap has already counted the lost benefit roll, so picking this option gives it back.
          restoreMishapTerm(step)
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
        case 'life-event':
          lifeEvent(`${effectKey}.life-event`, step, termSteps, term)
          break
        case 'ship-shares':
          shipShares += effect.count
          step.applied.push(`${effect.count} ship share${effect.count === 1 ? '' : 's'}`)
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
    const has = (type: Effect['type']) => row?.effects?.some((e) => e.type === type) ?? false
    // The lost term is counted before the row's effects, so a wager on this row can't bet that term's roll.
    const state = { endedCareer: false, lostTerm: false }
    if (endsCareer && term && !has('stay-in-career')) {
      term.endReason = MISHAP_END_REASON
      state.endedCareer = true
      if (rules.benefits.mishapLosesTerm && !has('keep-benefit')) {
        rs.lostBenefitTerms += 1
        state.lostTerm = true
        step.reasons.push(LOST_TERM_REASON)
      }
    }
    const outer = mishapState
    mishapState = state
    try {
      showRow(step, row, key, termSteps, term)
    } finally {
      mishapState = outer
    }
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
    const held = rollDMs(key, 'aging', `Term ${term.number} ${label}`)
    const { step, row } = tableRoll(key, label, rules.aging.dice, dm + held.dm, rules.aging.table)
    step.reasons.push(...reasons, ...held.reasons)
    const beforeAging = { ...changes }
    showRow(step, row, key, steps, term)
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

  /**
   * Returns the education entries the career pick at the next term can offer: none without
   * rules.preCareer, after a graduation, after a failed entry in the same term (`afterFailedEntry`), when
   * the next term is after rules.preCareer.lastTerm, or after a career unless an earlier entry failed (the
   * career was the one taken in place of the education, so the character may try again).
   */
  const educationOptions = (afterFailedEntry: boolean): EducationOption[] => {
    const pre = rules.preCareer
    if (!pre || graduated || afterFailedEntry || terms.length + 1 > pre.lastTerm) return []
    if (runs.length > 0 && !educations.some((e) => e.outcome === 'failed-entry')) return []
    return (data.education ?? []).map((e) => ({ id: e.id, name: e.name }))
  }

  /** Adds to `step` one reason per DM in `dms` whose characteristic is high enough, and returns their sum. */
  const characteristicDMs = (dms: { characteristic: Characteristic; atLeast: number; dm: number }[] | undefined, step: string[]): number => {
    let total = 0
    for (const d of dms ?? []) {
      if (value(d.characteristic) < d.atLeast) continue
      total += d.dm
      step.push(`DM ${signedText(d.dm)} for ${d.characteristic} ${d.atLeast} or more.`)
    }
    return total
  }

  /**
   * Plays one education attempt under `prefix`, as attempt `order`: the entry roll, and when it passes, the
   * education term (skills, one event, graduation and its benefits, and aging). Adds the record to
   * `educations`, and sets educationBonus for the next career.
   */
  const runEducation = (order: number, prefix: string, edu: EducationDefinition) => {
    inEducation = true
    try {
      playEducation(order, prefix, edu)
    } finally {
      inEducation = false
    }
  }

  /** The body of runEducation. A new run state keeps the education's effects off any earlier career. */
  const playEducation = (order: number, prefix: string, edu: EducationDefinition) => {
    career = undefined
    assignment = undefined
    educationBonus = undefined
    rs = newRunState()
    const number = terms.length + 1
    const entryKey = `${prefix}education.entry`
    const termDM = edu.entry.termDMs?.find((t) => t.term === number)?.dm ?? 0
    const reasons: string[] = []
    if (termDM !== 0) reasons.push(`DM ${signedText(termDM)} for an attempt in term ${number}.`)
    const dm = termDM + characteristicDMs(edu.entry.dms, reasons)
    const entry = check(entryKey, 'Entry', edu.entry, dm)
    entry.reasons.push(...reasons)
    const record: EducationRecord = { order, prefix, number, education: edu, entry, term: undefined, outcome: undefined, bonuses: [] }
    educations.push(record)
    if (!passed(entry)) {
      record.outcome = 'failed-entry'
      return
    }

    const termKey = `${prefix}education`
    const ageStart = rules.startingAge + (number - 1) * rules.termLength
    const term: TermResult = {
      key: termKey,
      number,
      careerTerm: 1,
      ageStart,
      ageEnd: ageStart + rules.termLength,
      steps: [],
      rank: 0,
      title: undefined,
      officer: false,
      endReason: undefined,
      stayReason: undefined,
      ageingCrisis: false,
      anagathics: false,
      education: edu.name,
    }
    terms.push(term)
    record.term = term
    const steps = term.steps

    const skillsStep: Step = { key: `${termKey}.skills`, label: 'Education skills', result: '', applied: [], notes: [], reasons: [] }
    steps.push(skillsStep)
    const picked: string[] = []
    if (edu.skills.kind === 'pick') {
      const { list } = edu.skills
      edu.skills.levels.forEach((level, i) => {
        const skill = pickOption(`${termKey}.skills.pick-${i}`, list.filter((s) => !picked.includes(s)))
        if (skill === '') return
        picked.push(skill)
        gainSkill(skill, skillsStep, level)
      })
    } else {
      const tiedId = edu.skills.career
      const tied = data.careers.find((c) => c.id === tiedId)
      if (!tied) skillsStep.notes.push(`Gain the Service Skills of the career "${tiedId}" at level 0 by hand: no loaded career pack has it.`)
      else tied.skillTables.serviceSkills.forEach((entry, i) => applyTableEntry(entry, skillsStep, 0, `${termKey}.skills.pick-${i}`))
    }
    applyEffects(edu.onEntry, `${termKey}.skills`, skillsStep, steps, term)
    skillsStep.result = skillsStep.applied.join(', ')

    const state = { failedGraduation: false }
    const outer = educationState
    educationState = state
    try {
      const { step, row } = tableRoll(`${termKey}.event`, 'Event', 2, 0, edu.events)
      showRow(step, row, `${termKey}.event`, steps, term)
    } finally {
      educationState = outer
    }

    const gradKey = `${termKey}.graduation`
    const sentTo = forcedNext
    if (state.failedGraduation || sentTo) {
      const why = state.failedGraduation ? 'An event failed graduation.' : 'An event sends the character to another career next term.'
      steps.push({ key: gradKey, label: 'Graduation', result: 'not rolled', applied: [], notes: [], reasons: [why] })
      record.outcome = 'failed'
    } else {
      const gradReasons: string[] = []
      const gradDM = characteristicDMs(edu.graduation.dms, gradReasons)
      const graduation = check(gradKey, 'Graduation', edu.graduation, gradDM)
      graduation.reasons.push(...gradReasons)
      steps.push(graduation)
      const honours = passed(graduation) && (graduation.total ?? 0) >= edu.graduation.honoursAt
      if (honours) graduation.reasons.push(`A total of ${edu.graduation.honoursAt} or more graduates with honours.`)
      const tied = edu.tiedCareer
      const tiedCareer = tied ? data.careers.find((c) => c.id === tied.career) : undefined
      const tiedName = tiedCareer?.name ?? tied?.career ?? ''
      if (passed(graduation)) {
        graduated = true
        record.outcome = honours ? 'honours' : 'graduated'
        const benefits: Step = { key: `${termKey}.benefits`, label: honours ? 'Graduation with honours' : 'Graduation', result: '', applied: [], notes: [], reasons: [] }
        steps.push(benefits)
        const raise = edu.benefits.raisePickedSkills ?? 0
        for (const skill of picked) for (let i = 0; i < raise; i += 1) gainSkill(skill, benefits)
        applyEffects(edu.benefits.effects, `${termKey}.benefits`, benefits, steps, term)
        if (honours) applyEffects(edu.benefits.honoursEffects, `${termKey}.benefits.honours`, benefits, steps, term)
        benefits.result = benefits.applied.join(', ')
        const q = edu.benefits.qualificationDM
        const c = edu.benefits.commission
        educationBonus = {
          school: edu.name,
          qualificationDM: q ? { careers: q.careers, dm: honours ? q.honoursDM : q.dm } : undefined,
          commission: c ? { careers: c.careers, dm: c.dm, automatic: honours && (c.honoursAutomatic ?? false) } : undefined,
          tied: tied ? { career: tied.career, serviceSkills: tied.serviceSkillsOnEntry, commission: true } : undefined,
        }
        if (q) record.bonuses.push(`DM ${signedText(honours ? q.honoursDM : q.dm)} to qualify for ${careerNames(q.careers)} as the next career.`)
        if (c) {
          record.bonuses.push(
            honours && c.honoursAutomatic
              ? `A commission with no roll before the first term of ${careerNames(c.careers)} as the next career.`
              : `A commission roll${c.dm === 0 ? '' : ` with DM ${signedText(c.dm)}`} before the first term of ${careerNames(c.careers)} as the next career.`,
          )
        }
        if (tied) {
          record.bonuses.push(
            `Entry to ${tiedName} with no qualification roll as the next career${tied.serviceSkillsOnEntry > 0 ? `, with ${tied.serviceSkillsOnEntry} Service Skills raised to 1` : ''}.`,
          )
        }
      } else {
        record.outcome = 'failed'
        const natural = graduation.dice === undefined ? 0 : current(graduation.dice)
        if (tied && natural > tied.failedEntryUnlessAtOrBelow) {
          educationBonus = { school: edu.name, qualificationDM: undefined, commission: undefined, tied: { career: tied.career, serviceSkills: 0, commission: false } }
          record.bonuses.push(`Entry to ${tiedName} with no qualification roll as the next career, with no commission roll in its first term.`)
        } else if (tied) {
          graduation.reasons.push(`Dice of ${natural} (${tied.failedEntryUnlessAtOrBelow} or less) lose the entry to ${tiedName}.`)
        }
      }
    }

    if (number >= rules.aging.fromTerm) ageing(`${termKey}.aging`, 'Aging', rules.aging.dmPerTerm * number, [], term, steps)
    anagathicsStreak = 0
  }

  /**
   * Applies graduation bonuses in term 1 of the career after education, after basic training: for the
   * academy's tied career, the player picks `serviceSkills` different Service Skills to raise to level 1;
   * for a career listed in the bonus commission, a commission roll (or none, when automatic) that, on a
   * pass, makes the character officer rank 1. Returns true when the term's usual commission roll is not
   * offered: after this commission roll, pass or fail, and in the tied career after a failed graduation.
   */
  const educationStart = (bonus: NonNullable<typeof educationBonus>, entered: CareerDefinition, steps: Step[], term: TermResult, termKey: string): boolean => {
    const tied = bonus.tied
    if (tied && tied.career === entered.id && tied.serviceSkills > 0) {
      const step: Step = { key: `${termKey}.academy-skills`, label: `${bonus.school}: Service Skills to 1`, result: '', applied: [], notes: [], reasons: [] }
      steps.push(step)
      const options = [...new Set(entered.skillTables.serviceSkills.flatMap((e) => entryOptions(e).filter((o) => asCharacteristic(o) === undefined)))]
      const picked: string[] = []
      for (let i = 0; i < tied.serviceSkills; i += 1) {
        const left = options.filter((o) => !picked.includes(o))
        if (left.length === 0) break
        const skill = pickOption(`${termKey}.academy-skills.pick-${i}`, left)
        picked.push(skill)
        gainSkill(skill, step, 1)
      }
      step.result = step.applied.join(', ')
    }
    const noTiedCommission = tied !== undefined && tied.career === entered.id && !tied.commission
    const commission = bonus.commission
    if (!commission || !commission.careers.includes(entered.id)) return noTiedCommission
    const key = `${termKey}.education-commission`
    if (!entered.commission) {
      steps.push({
        key,
        label: 'Commission (education)',
        result: '',
        applied: [],
        notes: [`${entered.name} has no commission check, so the commission from ${bonus.school} is not rolled.`],
        reasons: [],
      })
      return noTiedCommission
    }
    const step = commission.automatic
      ? automaticOutcome(key, 'Commission (education)', `Automatic commission with honours from ${bonus.school}.`)
      : check(key, 'Commission (education)', entered.commission, commission.dm)
    if (!commission.automatic) {
      step.reasons.push(`A commission roll before the first term, from ${bonus.school}.`)
      if (commission.dm !== 0) step.reasons.push(`DM ${signedText(commission.dm)} from ${bonus.school}.`)
    }
    steps.push(step)
    if (passed(step)) {
      rs.enlistedRankAtCommission = rs.rank
      rs.officerRank = 0
      reachRank(1, steps, term, `${termKey}.officer-rank-1`)
    }
    return true
  }

  /** Returns the names of the careers with ids `ids` (the id when a career isn't loaded), joined with "or". */
  const careerNames = (ids: string[]): string => ids.map((id) => data.careers.find((c) => c.id === id)?.name ?? id).join(' or ')

  try {
    let previous: CareerDefinition | undefined
    /** True when the attempt before this one was an education attempt, so the career pick must be made. */
    let afterEducation = false
    /** True when the attempt before this one was a failed education entry, so no education is offered. */
    let afterFailedEntry = false
    for (let k = 1; ; k += 1) {
      const prefix = k === 1 ? '' : `career-${k}.`
      const exclude = previous ? [previous.id] : []
      const forced = forcedNext
      forcedNext = undefined
      const careerNumber = runs.length + 1
      const offeredEducation = educationOptions(afterFailedEntry)
      const mustPick = k === 1 || afterEducation
      afterEducation = false
      afterFailedEntry = false
      const bonus = educationBonus
      educationBonus = undefined

      /**
       * Rolls the Draft under this career's prefix and returns the step, the career it names and its
       * assignment. Stops for a new career pick when that career isn't loaded.
       */
      const rollDraft = (draft: NonNullable<Rules['draft']>) => {
        const { step, row } = tableRoll(`${prefix}draft`, 'Draft', 1, 0, draft)
        const entered = data.careers.find((c) => c.id === row?.career)
        step.result = entered?.name ?? row?.career ?? ''
        if (!entered) {
          problems.push(`The Draft career "${row?.career ?? ''}" isn't loaded.`)
          throw new Stop({ kind: 'start', prefix, exclude, failedQualification: true, education: offeredEducation })
        }
        return { step, entered, assignmentId: row?.assignment }
      }

      /** Sets `assignment` for `entered`: `assignmentId`, its only assignment, or the player's pick. */
      const pickAssignment = (entered: CareerDefinition, assignmentId: string | undefined) => {
        assignment = entered.assignments.find((a) => a.id === assignmentId)
        if (!assignment && entered.assignments.length === 1) assignment = entered.assignments[0]
        if (assignment) return
        const key = `${prefix}assignment`
        const id = choice(key)
        assignment = entered.assignments.find((a) => a.id === id)
        if (assignment) return
        throw new Stop({
          kind: 'assignment',
          key,
          careerName: entered.name,
          options: entered.assignments.map((a) => ({ id: a.id, name: a.name })),
          keep: undefined,
        })
      }

      let forcedDraft: ReturnType<typeof rollDraft> | undefined
      let forcedTo = forced
      if (forcedTo?.kind === 'draft' && rules.draft) {
        try {
          forcedDraft = rollDraft(rules.draft)
          career = forcedDraft.entered
          assignment = undefined
        } catch (error) {
          // The Draft named a career no pack has: rollDraft listed the problem, and the player picks the
          // next career as usual instead.
          if (!(error instanceof Stop)) throw error
          problems.push('An event sent the character to the Draft, but the Draft named a career no pack has, so pick the next career.')
          forcedTo = undefined
        }
      }
      if (forcedTo?.kind === 'career') {
        career = forcedTo.career
        assignment = undefined
      } else if (!forcedTo) {
        const careerId = choice(`${prefix}start.career`)
        if (careerId?.startsWith('education:')) {
          const educationId = careerId.slice('education:'.length)
          const edu = offeredEducation.some((o) => o.id === educationId) ? data.education?.find((e) => e.id === educationId) : undefined
          if (edu) {
            runEducation(k, prefix, edu)
            previous = undefined
            afterEducation = true
            afterFailedEntry = educations[educations.length - 1]?.outcome === 'failed-entry'
            continue
          }
          problems.push(`The saved education "${educationId}" can't be picked for this term.`)
        }
        const named = careerId?.startsWith('education:') ? undefined : data.careers.find((c) => c.id === careerId)
        career = named !== undefined && canPick(named, exclude, psi !== undefined) ? named : undefined
        if (careerId !== undefined && !named && !careerId.startsWith('education:')) problems.push(`The saved career "${careerId}" isn't loaded.`)
        if (named?.entry === 'forced') problems.push(`${named.name} can be entered only when an event sends the character there.`)
        else if (named?.entry === 'psi-tested' && psi === undefined) {
          problems.push(`${named.name} can be picked only once the character's PSI has been tested.`)
        }
        else if (named && !career) problems.push(`${named.name} is the career just left, so it can't be entered again.`)
        const assignmentId = choice(`${prefix}start.assignment`)
        assignment = career?.assignments.find((a) => a.id === assignmentId)
        if (career && assignmentId !== undefined && !assignment) {
          problems.push(`The saved assignment "${assignmentId}" isn't part of ${career.name}.`)
        }
        if (!career || !assignment) {
          if (mustPick) throw new Stop({ kind: 'start', prefix, exclude, failedQualification: false, education: offeredEducation })
          finished = true
          nextCareer = { prefix, exclude, education: offeredEducation }
          break
        }
      }

      // Every branch above sets the career or stops; this narrows its type.
      if (!career) break
      let qualification: Step
      if (forcedTo) {
        const where = forcedTo.kind === 'draft' ? 'the Draft' : career.name
        qualification = {
          key: `${prefix}qualification`,
          label: 'Qualification',
          result: 'not rolled',
          applied: [],
          notes: [],
          reasons: [`No qualification roll: an event sent the character to ${where}.`],
        }
      } else if (bonus?.tied?.career === career.id) {
        qualification = automaticOutcome(`${prefix}qualification`, 'Qualification', `Automatic entry after ${bonus.school}.`)
      } else {
        const ageNow = rules.startingAge + terms.length * rules.termLength
        const earlier = careerNumber - 1
        const previousDM = (rules.qualification?.dmPerPreviousCareer ?? 0) * earlier
        const eventDM = nextDM.qualification
        const schoolDM = bonus?.qualificationDM?.careers.includes(career.id) ? bonus.qualificationDM.dm : 0
        qualification = qualify(
          `${prefix}qualification`,
          careerNumber === 1 ? 'Career' : `Career ${careerNumber}`,
          career.qualification,
          ageNow,
          eventDM + previousDM + schoolDM,
        )
        nextDM.qualification = 0
        if (qualification.dice !== undefined) {
          if (previousDM !== 0) {
            qualification.reasons.push(`DM ${signedText(previousDM)} for ${earlier} earlier career${earlier === 1 ? '' : 's'}.`)
          }
          if (eventDM !== 0) qualification.reasons.push(`DM ${signedText(eventDM)} from an event.`)
          if (schoolDM !== 0 && bonus) qualification.reasons.push(`DM ${signedText(schoolDM)} from graduating from ${bonus.school}.`)
        }
      }
      rs = newRunState()
      const run: CareerRun = {
        ...rs,
        index: careerNumber,
        order: k,
        prefix,
        applied: career,
        career,
        assignment,
        entry: forcedDraft ? 'draft' : 'qualified',
        forced: forcedTo !== undefined,
        qualification,
        draft: forcedDraft?.step,
      }
      rs = run
      runs.push(run)

      if (forcedTo) {
        const entered = career
        try {
          pickAssignment(entered, forcedDraft?.assignmentId)
        } finally {
          run.assignment = assignment
        }
      } else if (!passed(qualification)) {
        const fallback = data.careers.find((c) => c.id === rules.fallbackCareer)
        const draftAllowed = rules.draft !== undefined && !runs.some((r) => r.entry === 'draft')
        if (!fallback && !draftAllowed) throw new Stop({ kind: 'start', prefix, exclude, failedQualification: true, education: offeredEducation })
        const fallbackKey = `${prefix}fallback`
        const picked = choice(fallbackKey)
        let entered: CareerDefinition | undefined
        let assignmentId: string | undefined
        if (picked === 'draft' && draftAllowed && rules.draft) {
          const drafted = rollDraft(rules.draft)
          run.draft = drafted.step
          run.entry = 'draft'
          entered = drafted.entered
          assignmentId = drafted.assignmentId
        } else if (picked === 'fallback' && fallback) {
          run.entry = 'fallback'
          entered = fallback
        } else {
          throw new Stop({ kind: 'fallback', key: fallbackKey, draftAllowed, fallback: fallback?.name })
        }
        career = entered
        run.career = entered
        try {
          pickAssignment(entered, assignmentId)
        } finally {
          run.assignment = assignment
        }
      }
      if (!assignment) break

      /** True when education bonuses take the place of term 1's usual commission roll. */
      let skipCommission = false
      for (let n = 1; ; n += 1) {
        const termKey = `${prefix}term-${n}`
        const number = terms.length + 1
        // A career with assignmentEachTerm asks for the assignment at the start of each term after the first.
        let changedTo: Assignment | undefined
        if (n > 1 && career.assignmentEachTerm && career.assignments.length > 1) {
          const key = `${termKey}.assignment`
          const id = choice(key)
          changedTo = career.assignments.find((a) => a.id === id)
          if (!changedTo) {
            throw new Stop({
              kind: 'assignment',
              key,
              careerName: career.name,
              options: career.assignments.map((a) => ({ id: a.id, name: a.name })),
              keep: assignment.id,
            })
          }
          assignment = changedTo
          run.assignment = changedTo
          if (rs.officerRank === undefined) {
            const held = rs.rank
            rs.title = [...changedTo.ranks].filter((r) => r.rank <= held && r.title !== undefined).sort((a, b) => b.rank - a.rank)[0]?.title
          }
        }
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
        currentSteps = steps
        if (changedTo) {
          steps.push({ key: `${termKey}.assignment`, label: 'Assignment', result: changedTo.name, applied: [], notes: [], reasons: [] })
        }

        if (n === 1 && career.talents) {
          // Talent rolls come before basic training, in the order the player picks.
          const talents = career.talents
          const tried: string[] = []
          for (let i = 0; ; i += 1) {
            const left = talents.list
              .filter((t) => skills[t.name] === undefined && !tried.includes(t.name) && !talentsRolled.has(t.name))
              .map((t) => t.name)
            if (left.length === 0) break
            const key = `${termKey}.talents.pick-${i}`
            const name = pickFrom(key, left, () => ({ kind: 'talent', key, options: left }))
            const talent = talents.list.find((t) => t.name === name)
            if (!talent) break
            tried.push(talent.name)
            const rollKey = `${termKey}.talents.roll-${i}`
            if (i === 0 && talent.name === talents.automaticFirst) {
              const free: Step = {
                key: rollKey,
                label: `Talent: ${talent.name} (automatic)`,
                result: '',
                applied: [],
                notes: [],
                reasons: ['The first talent picked is gained with no roll.'],
              }
              steps.push(free)
              gainSkill(talent.name, free, 0, true)
              free.result = free.applied.join(', ')
              continue
            }
            const roll = talentRoll(rollKey, talent)
            steps.push(roll)
            if (passed(roll)) gainSkill(talent.name, roll, 0, true)
          }
        }

        if (n === 1) {
          const trainingTable: SkillTableKey = career.basicTraining === 'assignment' ? 'assignment' : rules.basicTraining.table
          const training: Step = {
            key: `${termKey}.training`,
            label: `Basic training: ${skillTableName(trainingTable)}${careerNumber === 1 ? '' : ' (one skill)'}`,
            result: '',
            applied: [],
            notes: [],
            reasons: [],
          }
          // The step is shown before its entries are applied, so a pick asked for here appears under it.
          steps.push(training)
          inBasicTraining = true
          try {
            if (careerNumber === 1) {
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
          } finally {
            inBasicTraining = false
          }
          reachRank(0, steps, term, `${termKey}.rank-0`)
          const parole = rollParole(`${termKey}.parole`)
          if (parole) steps.push(parole)
          if (bonus) skipCommission = educationStart(bonus, career, steps, term, termKey)
        }

        const drugs = rules.anagathics
        if (drugs) {
          // A career with anagathics: false offers none; a character on them in the term before stops.
          if (career.anagathics !== false && choice(`${termKey}.anagathics`) === 'take') {
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
        const survivalKey = `${termKey}.survival`
        // A dm-next survival DM goes on the term's first survival roll only, not on the anagathics roll.
        const survivalDMs = rollDMs(survivalKey, 'survival', `Term ${number} Survival`, 'survival')
        const survival = check(survivalKey, 'Survival', assignment.survival, survivalDMs.dm, rules.survival?.failOnNatural)
        survival.reasons.push(...survivalDMs.reasons)
        steps.push(survival)
        let survived = passed(survival)
        if (term.anagathics) {
          const secondDMs = rollDMs(`${termKey}.survival-2`, 'survival', `Term ${number} Survival (anagathics)`)
          const second = check(`${termKey}.survival-2`, 'Survival (anagathics)', assignment.survival, secondDMs.dm, rules.survival?.failOnNatural)
          second.reasons.push('Anagathics: a second survival roll this term.', ...secondDMs.reasons)
          steps.push(second)
          survived = survived && passed(second)
        }
        if (survived) {
          const { step, row } = tableRoll(`${termKey}.event`, 'Event', 2, 0, career.events)
          showRow(step, row, `${termKey}.event`, steps, term)
        } else {
          // In a career with parole a failed survival doesn't end the career.
          mishap(`${termKey}.mishap`, steps, term, career.parole === undefined)
        }

        let commissioned = false
        const commission = rules.commission
        if (
          survived &&
          commission &&
          career.commission &&
          rs.officerRank === undefined &&
          !promoteThisTerm &&
          !(n === 1 && skipCommission) &&
          (n === 1 || value('SOC') >= commission.anyTermFromSOC)
        ) {
          const tryKey = `${termKey}.commission.try`
          const answer = choice(tryKey)
          if (answer !== 'try' && answer !== 'skip') throw new Stop({ kind: 'commission', key: tryKey })
          if (answer === 'try') {
            const laterDM = commission.dmPerLaterTerm * (n - 1)
            // The advancement DM from an event is used up by the commission roll, pass or fail.
            const eventDMs = rollDMs(`${termKey}.commission`, 'commission', `Term ${number} Commission`, 'advancement')
            const step = check(`${termKey}.commission`, 'Commission', career.commission, laterDM + eventDMs.dm)
            if (laterDM !== 0) step.reasons.push(`DM ${signedText(laterDM)} for ${n - 1} term${n === 2 ? '' : 's'} after the first.`)
            step.reasons.push(...eventDMs.reasons)
            steps.push(step)
            if (passed(step)) {
              commissioned = true
              rs.enlistedRankAtCommission = rs.rank
              rs.officerRank = 0
              step.reasons.push('A commission replaces this term’s advancement roll.')
              reachRank(1, steps, term, `${termKey}.officer-rank-1`)
              for (let i = 0; i < rules.skillRolls.onAdvancement; i += 1) skillRoll(`${termKey}.advancement-skill-${i}`, steps)
            }
          }
        }

        /** The advancement total this term, or undefined when no advancement roll was made. */
        let advancementTotal: number | undefined
        if (survived && !commissioned) {
          const advancementKey = `${termKey}.advancement`
          let advancement: Step
          if (promoteThisTerm) {
            advancement = automaticOutcome(advancementKey, 'Advancement', 'Automatic promotion from an event this term.')
          } else {
            const eventDMs = rollDMs(advancementKey, 'advancement', `Term ${number} Advancement`, 'advancement')
            advancement = check(advancementKey, 'Advancement', assignment.advancement, eventDMs.dm)
            advancement.reasons.push(...eventDMs.reasons)
            const adv = rules.advancement
            const natural = advancement.dice === undefined ? 0 : current(advancement.dice)
            const total = advancement.total ?? 0
            advancementTotal = total
            // A career with parole ends only by the Parole Threshold or an effect (see below), so these rules skip it.
            const usual = career.parole === undefined
            if (usual && adv?.stayOnNatural !== undefined && natural >= adv.stayOnNatural && term.endReason === undefined) {
              term.stayReason = `Natural ${natural} on advancement: you must continue in this career.`
              advancement.reasons.push(term.stayReason)
            } else if (usual && adv?.leaveAtOrBelowTerms && total <= n && term.endReason === undefined) {
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

        if (career.parole !== undefined && term.endReason === undefined) {
          const threshold = rs.parole ?? 0
          // An automatic promotion or a commission has no advancement total, so the parole check is its own roll
          // with the assignment's advancement check.
          let paroleStepKey = `${termKey}.advancement`
          if (survived && advancementTotal === undefined) {
            paroleStepKey = `${termKey}.parole-check`
            const roll = check(paroleStepKey, 'Advancement (parole)', assignment.advancement, 0)
            roll.reasons.push('No advancement roll was made this term, so this roll is compared with the Parole Threshold.')
            steps.push(roll)
            advancementTotal = roll.total
          }
          const ends = advancementTotal !== undefined && advancementTotal > threshold
          const reason =
            advancementTotal === undefined
              ? 'Survival failed, so there is no advancement roll this term and the character must continue.'
              : ends
                ? `Advancement ${advancementTotal} is above the Parole Threshold ${threshold}, so the sentence ends after this term.`
                : `Advancement ${advancementTotal} is not above the Parole Threshold ${threshold}, so the character must continue.`
          if (ends) term.endReason = reason
          else term.stayReason = reason
          steps.find((st) => st.key === paroleStepKey)?.reasons.push(reason)
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

      currentSteps = undefined
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
        const label = table === 'cash' ? 'Cash roll' : 'Benefit roll'
        const held = rollDMs(key, 'benefit', `${careerNumber === 1 ? 'Mustering out' : `Career ${careerNumber} mustering out`} ${label} ${i + 1}`)
        const dm = (table === 'benefit' ? benefitDM + rankDM : rankDM + cashSkillDM) + held.dm
        const eventDM = table === 'benefit' ? benefitDM : 0
        if (table === 'benefit') benefitDM = 0
        const { step, row } = tableRoll(key, label, 1, dm, career.musteringOut)
        if (rankDM !== 0) step.reasons.push(`DM ${signedText(rankDM)} from rank ${benefitRank}.`)
        if (eventDM !== 0) step.reasons.push(`DM ${signedText(eventDM)} from an event.`)
        if (table === 'cash' && cashSkillDM !== 0 && cashSkill) step.reasons.push(`DM ${signedText(cashSkillDM)} from ${cashSkill.skill}.`)
        step.reasons.push(...held.reasons)
        const result: BenefitResult = {
          step,
          table,
          cash: table === 'cash' ? (row?.cash ?? 0) : 0,
          benefit: table === 'benefit' ? row?.benefit : undefined,
        }
        step.result = table === 'cash' ? `Cr${result.cash}` : (result.benefit ?? '')
        const shares = table === 'benefit' ? row?.shipShares : undefined
        if (shares) {
          shipShares += shares
          step.applied.push(`${shares} ship share${shares === 1 ? '' : 's'}`)
        }
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
  for (const { dm, from } of later) {
    dm.targets = rollLog
      .slice(from)
      .filter((r) => dm.rolls === undefined || dm.rolls.includes(r.kind))
      .map(({ key, label }) => ({ key, label }))
  }
  const last = runs[runs.length - 1]
  const benefits = runs.flatMap((r) => r.benefits)
  const sum = (f: (r: CareerRun) => number) => runs.reduce((total, r) => total + f(r), 0)
  return {
    runs,
    educations,
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
    unusedNextDMs: { advancement: nextDM.advancement, survival: nextDM.survival },
    laterDMs: later.map((l) => l.dm),
    cash: benefits.reduce((total, b) => total + b.cash, 0) - costs,
    shipShares,
    psi,
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

/**
 * Returns whether the career pick can offer `career`: false for a career in `exclude` (the career just left),
 * for a forced-entry career (`entry: "forced"`), which only an event can send a character to, and for a
 * `psi-tested` career while `psiTested` is false.
 */
export function canPick(career: CareerDefinition, exclude: string[], psiTested: boolean): boolean {
  return !exclude.includes(career.id) && career.entry !== 'forced' && (career.entry !== 'psi-tested' || psiTested)
}

/** Returns `n` as text with its sign: "+1", "-2", "+0". */
function signedText(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`
}

/** The reason a mishap step gives when its term gives no benefit roll (rules.benefits.mishapLosesTerm). */
const LOST_TERM_REASON = 'This term gives no benefit roll because it ended in a mishap.'

/** The end reason a mishap that ends the career sets on its term. */
const MISHAP_END_REASON = 'Survival failed, so this career ends after this term.'

/** Returns the rolls a `dm-later` DM may be applied to, as text: "one later roll", or "one later advancement or survival roll". */
export function laterRollsText(rolls: RollKind[] | undefined): string {
  if (rolls === undefined) return 'one later roll'
  return `one later ${rolls.map((r) => (r === 'benefit' ? 'mustering-out' : r)).join(' or ')} roll`
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

/**
 * What removeLastTerm returns: the new input, and the number (from 1) of the earliest term it removed, which
 * is the last term unless an education term was removed with it.
 */
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
 * pending. When the term before is an education term, which has no after-term choice, the removed term's
 * start choices are removed instead, so the career pick after the education term is pending; when the
 * removed term's career has no start choices (a next-career event in the education term forced it), the
 * education term is removed too, and `removed` is the education term's number. Every choice,
 * roll override and outcome override the rebuilt career no longer reads is
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
  if (terms.length === 0) return undefined
  /** Returns the start choice keys of the career or education that `term` belongs to. */
  const startKeys = (term: TermResult) => {
    const prefix = term.key.replace(/(term-\d+|education)$/, '')
    return [`${prefix}start.career`, `${prefix}start.assignment`]
  }
  // After an education term there is no after-term choice, so the start choices of the term after it are
  // removed instead. When there are none (a next-career event in the education term forced the career),
  // the education term is removed as well.
  let index = terms.length - 1
  let drop: string[] = []
  for (;;) {
    const before = terms[index - 1]
    const cut = terms[index]
    if (!before || !cut) break
    drop = before.education === undefined ? [`${before.key}.next`] : startKeys(cut)
    if (before.education === undefined || drop.some((k) => k in input.choices)) break
    index -= 1
  }
  const first = terms[index]
  if (!first) return undefined
  const notes = Object.fromEntries(
    Object.entries(input.notes).filter(([k]) => {
      const match = NOTES_KEY.exec(k)
      return match === null || Number(match[1]) < first.number
    }),
  )
  if (index === 0) return { input: { ...EMPTY_INPUT, notes }, removed: first.number }
  const choices = Object.fromEntries(Object.entries(input.choices).filter(([k]) => !drop.includes(k)))
  const trimmed: CareerInput = { ...input, choices, notes }
  return { input: pruneInput(trimmed, buildCareer(seed, base, trimmed, data).usedKeys).input, removed: first.number }
}
