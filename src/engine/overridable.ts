/**
 * A value the generator decided, stored with the value the dice produced (`rolled`) and an
 * optional value the player entered instead (`override`).
 */
export interface Overridable<T> {
  rolled: T
  override?: T
}

/** Returns an Overridable holding `value` as the rolled value, with no override. */
export function rolled<T>(value: T): Overridable<T> {
  return { rolled: value }
}

/** Returns the override if one is set, otherwise the rolled value. */
export function current<T>(o: Overridable<T>): T {
  return o.override !== undefined ? o.override : o.rolled
}

/** Returns true when an override is set and it differs from the rolled value. */
export function isOverridden<T>(o: Overridable<T>): boolean {
  return o.override !== undefined && o.override !== o.rolled
}

/**
 * Returns a copy of `o` with its override set to `value`. Passing undefined, or a value equal to
 * the rolled value, returns a copy with no override.
 */
export function withOverride<T>(o: Overridable<T>, value: T | undefined): Overridable<T> {
  return value === undefined || value === o.rolled ? { rolled: o.rolled } : { rolled: o.rolled, override: value }
}
