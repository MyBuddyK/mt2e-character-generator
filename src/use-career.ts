import { useMemo, useState } from 'react'
import type { Characteristic } from './engine/characteristics'
import type { CareerDefinition } from './engine/career-schema'
import type { EducationDefinition } from './engine/education-schema'
import { finishCareer } from './engine/policy'
import type { Rules } from './engine/rules-schema'
import { buildCareer, EMPTY_INPUT, pruneInput, removeLastTerm, type CareerInput, type CareerResult } from './engine/terms'
import { browserStorage } from './storage/career-packs'
import { readSavedCharacter, writeSavedCharacter, type SavedCharacter } from './storage/characters'

/** What useCareer returns to the Career section. */
export interface CareerState {
  input: CareerInput
  result: CareerResult
  /** A saved character for this seed that was made with other packs, until the player applies or discards it. */
  savedFromOtherPacks: SavedCharacter | undefined
  /** How many choices or overrides the last change removed because they no longer apply. */
  removedCount: number
  /** True when the last save failed. */
  saveFailed: boolean
  /** The number of the term the last change removed with removeLastTerm, or undefined after any other change. */
  removedTerm: number | undefined
  /** Replaces the input, removes keys the new build doesn't read, and saves it. */
  update: (next: CareerInput) => void
  /** Makes the remaining choices with the Finish career policy, and saves the result. */
  generate: () => void
  /** Applies savedFromOtherPacks to this character. */
  applySaved: () => void
  /** Deletes savedFromOtherPacks and starts this character over. */
  discardSaved: () => void
  /** Removes the most recent term with removeLastTerm and saves the result. Does nothing when there are no terms. */
  removeLastTerm: () => void
}

interface LoadedState {
  seed: string
  packs: string
  input: CareerInput
  savedFromOtherPacks: SavedCharacter | undefined
  removedCount: number
  saveFailed: boolean
  removedTerm: number | undefined
}

/**
 * Returns the saved state for `seed`: its input when it was saved with `packs`, or an empty input
 * and the saved character in `savedFromOtherPacks` when it was saved with other packs.
 */
function load(storage: Storage | undefined, seed: string, packs: string): LoadedState {
  const saved = readSavedCharacter(storage, seed)
  const matches = saved !== undefined && saved.packs === packs
  return {
    seed,
    packs,
    input: matches ? saved.input : EMPTY_INPUT,
    savedFromOtherPacks: saved !== undefined && !matches ? saved : undefined,
    removedCount: 0,
    saveFailed: false,
    removedTerm: undefined,
  }
}

/**
 * React hook that holds the career input for the character with `seed`, builds the career with
 * buildCareer, and saves the input in localStorage with the loaded packs' `packs` value. `careers`, `rules` and
 * `education` (the education entries the career pick offers) are the data buildCareer reads. When the
 * seed or the loaded packs change, it loads the saved input for the new pair (see load).
 */
export function useCareer(
  seed: string,
  base: Record<Characteristic, number>,
  careers: CareerDefinition[],
  rules: Rules,
  education: EducationDefinition[],
  packs: string,
): CareerState {
  const [storage] = useState(() => browserStorage())
  const [state, setState] = useState<LoadedState>(() => load(storage, seed, packs))
  let active = state
  if (state.seed !== seed || state.packs !== packs) {
    active = load(storage, seed, packs)
    setState(active)
  }
  const data = useMemo(() => ({ careers, rules, education }), [careers, rules, education])
  const { choices, rolls, outcomes } = active.input
  // buildCareer does not read notes, so a notes change keeps the same choices, rolls and outcomes objects and skips the rebuild.
  const result = useMemo(
    () => buildCareer(seed, base, { choices, rolls, outcomes, notes: {} }, data),
    [seed, base, choices, rolls, outcomes, data],
  )

  /**
   * Prunes `next` against its own build, saves it, and records how many keys were removed. When only
   * the notes changed, or `removedTerm` is given (removeLastTerm has already pruned `next`), it skips
   * the build and pruning. It sets removedTerm to `removedTerm`, so any other change clears it.
   * `savedFromOtherPacks` is applied when given.
   */
  const commit = (next: CareerInput, extra: { savedFromOtherPacks?: undefined; removedTerm?: number } = {}) => {
    const notesOnly =
      next.choices === active.input.choices && next.rolls === active.input.rolls && next.outcomes === active.input.outcomes
    const { input: pruned, removed } =
      notesOnly || extra.removedTerm !== undefined
        ? { input: next, removed: [] }
        : pruneInput(next, buildCareer(seed, base, next, data).usedKeys)
    const empty =
      Object.keys(pruned.choices).length === 0 &&
      Object.keys(pruned.rolls).length === 0 &&
      Object.keys(pruned.outcomes).length === 0 &&
      Object.values(pruned.notes).every((n) => n === '')
    const write = writeSavedCharacter(storage, seed, empty ? undefined : { packs, input: pruned })
    setState((s) => ({
      ...s,
      ...('savedFromOtherPacks' in extra ? { savedFromOtherPacks: undefined } : {}),
      removedTerm: extra.removedTerm,
      input: pruned,
      removedCount: removed.length,
      saveFailed: write === 'failed',
    }))
  }

  return {
    input: active.input,
    result,
    savedFromOtherPacks: active.savedFromOtherPacks,
    removedCount: active.removedCount,
    saveFailed: active.saveFailed,
    removedTerm: active.removedTerm,
    update: (next) => commit(next),
    generate: () => commit(finishCareer(seed, base, active.input, data)),
    applySaved: () => {
      if (active.savedFromOtherPacks) commit(active.savedFromOtherPacks.input, { savedFromOtherPacks: undefined })
    },
    discardSaved: () => {
      writeSavedCharacter(storage, seed, undefined)
      setState((s) => ({ ...s, savedFromOtherPacks: undefined, input: EMPTY_INPUT, removedCount: 0, removedTerm: undefined }))
    },
    removeLastTerm: () => {
      const removal = removeLastTerm(seed, base, active.input, data, result)
      if (removal) commit(removal.input, { removedTerm: removal.removed })
    },
  }
}
