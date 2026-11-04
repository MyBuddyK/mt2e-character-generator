import { z } from 'zod'
import { CHARACTERISTICS, normalizeCharacteristic, type Characteristic, type Characteristics } from './characteristics'
import { current } from './overridable'

/**
 * Species (docs/features/species.md). A species changes the rolled characteristics by fixed modifiers and
 * has traits that are shown as text. Species values come from career packs; only Human is built in.
 */

const nonEmpty = z.string().trim().min(1, 'must be a non-empty string')

/** One species trait: a name and a short summary. Unknown keys are rejected. */
export const TraitSchema = z.strictObject({ name: nonEmpty, summary: nonEmpty })
/** One trait, as described by TraitSchema. */
export type Trait = z.infer<typeof TraitSchema>

/**
 * One species. `modifiers` holds a whole number per characteristic (characteristics left out get 0).
 * `minCharacteristic`, when set, is the lowest value a modifier can take a characteristic to. Unknown keys
 * are rejected.
 */
export const SpeciesSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  /** Where the full rules for this species live, e.g. "Core Rulebook p.XX". */
  source: nonEmpty,
  summary: nonEmpty,
  modifiers: z.partialRecord(z.enum(CHARACTERISTICS), z.int()),
  minCharacteristic: z.int().min(0).optional(),
  traits: z.array(TraitSchema),
})
/** A validated species, as described by SpeciesSchema. */
export type SpeciesDefinition = z.infer<typeof SpeciesSchema>

/** The built-in species: id "human", no modifiers, no traits. */
export const HUMAN: SpeciesDefinition = {
  id: 'human',
  name: 'Human',
  source: 'Built in',
  summary: 'No characteristic modifiers or traits.',
  modifiers: {},
  traits: [],
}

/**
 * Checks parsed JSON against SpeciesSchema. Returns the species when it passes, otherwise one message per
 * problem in the form "path: message". It does not throw.
 */
export function parseSpecies(data: unknown): { ok: true; species: SpeciesDefinition } | { ok: false; errors: string[] } {
  const result = SpeciesSchema.safeParse(data)
  if (result.success) return { ok: true, species: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  }
}

/** Returns the modifier `species` gives characteristic `key`: the listed value, or 0 when none is listed. */
export function speciesModifier(species: SpeciesDefinition, key: Characteristic): number {
  return species.modifiers[key] ?? 0
}

/**
 * Returns the modified value of characteristic `key` for a dice total `rolled`: rolled plus the species
 * modifier, raised to `minCharacteristic` when it is below it, then rounded and clamped with
 * normalizeCharacteristic. A value above 15 is kept.
 */
export function speciesValue(rolled: number, species: SpeciesDefinition, key: Characteristic): number {
  const raw = rolled + speciesModifier(species, key)
  const floored = species.minCharacteristic !== undefined ? Math.max(species.minCharacteristic, raw) : raw
  return normalizeCharacteristic(floored) ?? 0
}

/**
 * Returns characteristics whose `rolled` is the modified value from speciesValue, so `current` gives the
 * override when one is set and the modified value otherwise. An override equal to the modified value is
 * dropped. The input is not changed.
 */
export function applySpecies(chars: Characteristics, species: SpeciesDefinition): Characteristics {
  const one = (key: Characteristic) => {
    const value = speciesValue(chars[key].rolled, species, key)
    const override = chars[key].override
    return override === undefined || override === value ? { rolled: value } : { rolled: value, override }
  }
  return { STR: one('STR'), DEX: one('DEX'), END: one('END'), INT: one('INT'), EDU: one('EDU'), SOC: one('SOC') }
}

/** Returns the current value of each characteristic after applySpecies, as passed to buildCareer. */
export function speciesBase(chars: Characteristics, species: SpeciesDefinition): Record<Characteristic, number> {
  const applied = applySpecies(chars, species)
  return {
    STR: current(applied.STR),
    DEX: current(applied.DEX),
    END: current(applied.END),
    INT: current(applied.INT),
    EDU: current(applied.EDU),
    SOC: current(applied.SOC),
  }
}

/** A pack's species, as passed to combineSpecies. */
export interface PackSpecies {
  id: string
  name: string
  species: SpeciesDefinition[]
}

/**
 * Returns the species to offer: HUMAN first, then every pack species sorted by name and then id in UTF-16
 * code unit order. Packs are read in order of their `id`. A species whose id is "human" or was already
 * taken by an earlier pack is left out and reported as "<pack name>: species id "<id>" is already used by
 * <owner>", where the owner of "human" is "the built-in Human".
 */
export function combineSpecies(packs: PackSpecies[]): { species: SpeciesDefinition[]; problems: string[] } {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const owners = new Map<string, string>([[HUMAN.id, 'the built-in Human']])
  const found: SpeciesDefinition[] = []
  const problems: string[] = []
  for (const pack of [...packs].sort((a, b) => compare(a.id, b.id))) {
    for (const species of pack.species) {
      const owner = owners.get(species.id)
      if (owner !== undefined) {
        problems.push(`${pack.name}: species id "${species.id}" is already used by ${owner}`)
        continue
      }
      owners.set(species.id, pack.name)
      found.push(species)
    }
  }
  found.sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
  return { species: [HUMAN, ...found], problems }
}
