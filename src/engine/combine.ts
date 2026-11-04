/**
 * Helpers shared by combineCareers (career-pack.ts) and combineSpecies (species.ts): the locale-free
 * string order, and how entries from several packs are merged by id.
 */

/** Compares two strings by UTF-16 code units, so the order is the same in every locale. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** One pack's entries, as passed to combineById. */
export interface PackItems<T> {
  id: string
  name: string
  items: T[]
}

/**
 * Merges the entries of `packs` by id. Packs are read in order of their `id` (code unit order). An entry
 * whose id is in `reserved` (id → owner name) or was taken by an earlier pack is left out and reported as
 * "<pack name>: <kind> id "<id>" is already used by <owner>". The kept entries are sorted by name and
 * then id in code unit order. The inputs are not changed.
 */
export function combineById<T extends { id: string; name: string }>(
  packs: PackItems<T>[],
  kind: string,
  reserved: ReadonlyMap<string, string> = new Map(),
): { items: T[]; problems: string[] } {
  const owners = new Map(reserved)
  const items: T[] = []
  const problems: string[] = []
  for (const pack of [...packs].sort((a, b) => compareCodeUnits(a.id, b.id))) {
    for (const item of pack.items) {
      const owner = owners.get(item.id)
      if (owner !== undefined) {
        problems.push(`${pack.name}: ${kind} id "${item.id}" is already used by ${owner}`)
        continue
      }
      owners.set(item.id, pack.name)
      items.push(item)
    }
  }
  items.sort((a, b) => compareCodeUnits(a.name, b.name) || compareCodeUnits(a.id, b.id))
  return { items, problems }
}
