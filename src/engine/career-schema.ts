import { CHARACTERISTICS, type Characteristic } from './characteristics'

/**
 * Shape of a career data file in src/data/careers. The engine reads these so
 * careers can be added from your own books without touching code.
 *
 * Keep descriptions short and in your own words: this repo is public, so
 * don't paste rulebook text into it.
 */

/** A check such as "END 7+". */
export interface Check {
  characteristic: Characteristic
  target: number
}

/** One entry in a D6 skill table: a skill name, optionally with a level or speciality. */
export type SkillTableEntry = string

/** An event or mishap table entry. `connection` marks it as a good prompt for linking characters. */
export interface EventEntry {
  roll: number
  summary: string
  connection?: boolean
}

export interface Rank {
  rank: number
  title?: string
  bonus?: string
}

export interface Assignment {
  id: string
  name: string
  survival: Check
  advancement: Check
  /** Six entries, indexed by D6 roll minus one. */
  skills: SkillTableEntry[]
  ranks: Rank[]
}

export interface MusterOutEntry {
  roll: number
  cash: number
  benefit: string
}

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

/** Returns a list of problems; an empty list means the career file is usable. */
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
