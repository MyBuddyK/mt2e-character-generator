import { CHARACTERISTICS, type Characteristic } from './characteristics'

/**
 * Types for the career data files in src/data/careers. Adding a career means adding a JSON file
 * in this shape; no code changes are needed.
 *
 * Descriptions hold short summaries, not rulebook text (see the rules in CLAUDE.md).
 */

/** A characteristic check that succeeds on 2D + DM >= target, e.g. END 7+. */
export interface Check {
  characteristic: Characteristic
  target: number
}

/** One entry in a D6 skill table: a skill or characteristic name, optionally with a level or speciality. */
export type SkillTableEntry = string

/** An event or mishap table entry. `connection: true` marks an entry as a possible link between two characters. */
export interface EventEntry {
  roll: number
  summary: string
  connection?: boolean
}

/** A rank within an assignment: its number, optional title and optional bonus gained on reaching it. */
export interface Rank {
  rank: number
  title?: string
  bonus?: string
}

/** One assignment within a career, with its own survival and advancement checks, skill table and ranks. */
export interface Assignment {
  id: string
  name: string
  survival: Check
  advancement: Check
  /** Six entries, indexed by D6 roll minus one. */
  skills: SkillTableEntry[]
  ranks: Rank[]
}

/** One mustering-out row: the 1D roll, the cash amount and the benefit. */
export interface MusterOutEntry {
  roll: number
  cash: number
  benefit: string
}

/** The full contents of one career data file. */
export interface CareerDefinition {
  id: string
  name: string
  /** Where the full rules for this career live, e.g. "Core Rulebook p.XX". */
  source: string
  summary: string
  qualification: Check
  /** Each skill table has six entries. */
  skillTables: {
    personalDevelopment: SkillTableEntry[]
    serviceSkills: SkillTableEntry[]
    advancedEducation?: SkillTableEntry[]
  }
  assignments: Assignment[]
  /** 2D events (2 to 12). */
  events: EventEntry[]
  /** D6 mishaps (1 to 6). */
  mishaps: EventEntry[]
  musteringOut: MusterOutEntry[]
}

/**
 * Checks a parsed career file against CareerDefinition and returns one message per problem found.
 * An empty array means every checked field is present and has the expected shape.
 */
export function validateCareer(data: unknown): string[] {
  const errors: string[] = []
  const c = data as Partial<CareerDefinition>
  const isCheck = (v: unknown): v is Check =>
    typeof v === 'object' &&
    v !== null &&
    CHARACTERISTICS.includes((v as Check).characteristic) &&
    typeof (v as Check).target === 'number'
  const isSixSkills = (v: unknown) => Array.isArray(v) && v.length === 6 && v.every((s) => typeof s === 'string')

  if (typeof c !== 'object' || c === null) return ['career is not an object']
  if (!c.id) errors.push('missing id')
  if (!c.name) errors.push('missing name')
  if (!isCheck(c.qualification)) errors.push('qualification must be a check like { characteristic: "INT", target: 6 }')
  if (!c.skillTables) errors.push('missing skillTables')
  else {
    if (!isSixSkills(c.skillTables.personalDevelopment)) errors.push('personalDevelopment needs 6 entries')
    if (!isSixSkills(c.skillTables.serviceSkills)) errors.push('serviceSkills needs 6 entries')
    if (c.skillTables.advancedEducation && !isSixSkills(c.skillTables.advancedEducation))
      errors.push('advancedEducation needs 6 entries')
  }
  if (!Array.isArray(c.assignments) || c.assignments.length === 0) errors.push('needs at least one assignment')
  else
    c.assignments.forEach((a, i) => {
      if (!a.id || !a.name) errors.push(`assignment ${i} missing id or name`)
      if (!isCheck(a.survival)) errors.push(`assignment ${a.id ?? i} has an invalid survival check`)
      if (!isCheck(a.advancement)) errors.push(`assignment ${a.id ?? i} has an invalid advancement check`)
      if (!isSixSkills(a.skills)) errors.push(`assignment ${a.id ?? i} skills need 6 entries`)
    })
  if (!Array.isArray(c.events) || c.events.length !== 11) errors.push('events needs 11 entries (2 to 12)')
  if (!Array.isArray(c.mishaps) || c.mishaps.length !== 6) errors.push('mishaps needs 6 entries (1 to 6)')
  if (!Array.isArray(c.musteringOut) || c.musteringOut.length === 0) errors.push('musteringOut needs entries')
  return errors
}
