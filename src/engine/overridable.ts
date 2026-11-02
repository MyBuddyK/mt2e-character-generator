/**
 * Every value the generator decides is stored as an Overridable: the value the
 * dice produced, plus an optional value the player chose instead. The UI shows
 * both so a player (or referee) can see what was rolled and what was changed.
 */
export interface Overridable<T> {
  rolled: T
  override?: T
}

export function rolled<T>(value: T): Overridable<T> {
  return { rolled: value }
}

export function current<T>(o: Overridable<T>): T {
  return o.override !== undefined ? o.override : o.rolled
}

export function isOverridden<T>(o: Overridable<T>): boolean {
  return o.override !== undefined && o.override !== o.rolled
}

export function withOverride<T>(o: Overridable<T>, value: T | undefined): Overridable<T> {
  return value === undefined || value === o.rolled ? { rolled: o.rolled } : { rolled: o.rolled, override: value }
}
