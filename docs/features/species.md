# Species selection

Status: built.

## Problem

Players want to make alien Travellers, not only humans. The Core Rulebook makes an alien the same way as a
human with two differences: characteristic modifiers applied straight after the characteristics are rolled,
and traits. Buddy asked on 2026-11-04 for species selection with Aslan and Vargr, using that model. The
species values are rulebook data, so they go in Buddy's private career pack, and the repo holds only the
format and invented test data.

## User flow

1. The player opens the page. The Species select above the characteristics shows Human.
2. With a career pack that defines species loaded, the select also lists those species.
3. The player picks a species. Each characteristic shows its roll, the species modifier and the modified
   value, and the UPP and the Career section use the modified values. The species' traits are listed under
   the table.
4. The player can still override any characteristic; the override replaces the modified value.
5. Reroll or Clear seed rolls a new character and keeps the picked species.
6. Opening the seed's link again in the same browser shows the species picked for it.

## UI

- **Species select** in the Characteristics section, above the table, labelled "Species". Options are Human
  first, then the loaded species by name.
- **Modifier column** ("Species") between Roll and Value, shown only when the picked species has at least
  one modifier. A cell shows the modifier with its sign ("+2", "-1") or "0".
- **Traits** under the table: a list of each trait's name and summary, with the species' source. Hidden for
  a species with no traits.
- **Missing species notice**: when the species saved for the seed is not in any loaded pack, a notice in the
  Characteristics section names its id and says the character is shown as Human until a pack that defines
  it is loaded.

## Decisions

1. **Species are pack data.** Career pack format version 3 adds an optional `species` array. Each entry
   passes `SpeciesSchema` (`src/engine/species.ts`): `id`, `name`, `source`, `summary`, `modifiers` (a whole
   number per characteristic, any left out are 0), an optional `minCharacteristic`, and `traits` (each a
   `name` and `summary`). Unknown keys are rejected. A pack that lists `species` must say version 3. A
   species entry that fails is left out and listed in the pack's problems, and the rest of the pack loads.
2. **Human is built in.** It has id `human`, no modifiers and no traits, holds no rulebook value, and is
   always offered first. A pack species with id `human`, or with an id an earlier pack already used (packs
   are read in order of their `id`, as for careers), is left out and listed with the duplicate careers.
3. **The modifier applies to the roll.** The modified value is the dice total plus the modifier, raised to
   `minCharacteristic` when it is below it, then clamped to 0 to 33 like any characteristic. A value above 15
   is kept. `minCharacteristic` limits only characteristics the species modifies; one with no modifier is
   its dice total, so a value differs from its roll only when the Species column shows a modifier for it.
4. **An override replaces the modified value.** Reset returns to the modified value. Typing the modified
   value removes the override. When the species in use changes (a new pick, or a pack that defines the saved
   species loading or being removed), an override equal to the new modified value is removed; other
   overrides keep their values.
5. **Picking a species rolls no dice.** The characteristics and every career roll keep the same dice totals
   for the same seed whichever species is picked; only totals that add a characteristic DM can change.
6. **The species is saved per seed.** It is kept in localStorage under `mt2e.species.v1`, as a map from
   seed to species id. Picking Human removes the seed's entry. Each seed is read as its own key, so seeds
   such as `__proto__` work like any other, and an entry that isn't a species id is ignored without hiding
   the other seeds' entries. Reroll and Clear seed save the species in use for the new seed; a saved
   species that no loaded pack defines is not carried, so the new seed is Human. When a save fails, a
   notice says the species stays only until the page closes.
7. **A missing species is shown, not dropped.** A saved species id that no loaded pack defines shows the
   notice above and builds the character as Human. The saved id is kept, so loading the pack brings the
   species back.
8. **Traits are text.** The Core Rulebook traits apply in play, not to creation rolls, so the app lists them
   and changes nothing else. Their mapping to the Foundry export is planned with the export.

## Engine and data changes

- `src/engine/species.ts`: `SpeciesSchema`, `HUMAN`, `parseSpecies`, `speciesValue`, `applySpecies` and
  `combineSpecies`.
- `src/engine/career-pack.ts`: format version 3, the `species` field, and `species` in the parse result.
- `src/engine/character.ts`: `overrideCharacteristic` takes the species, so typing the modified value
  removes the override.
- `src/storage/species.ts`: reading and writing the saved species per seed.
- `e2e/fixtures/species-pack.json`: an invented pack with two species, one with a modifier that reaches
  `minCharacteristic` for a fixed seed, and one broken species entry.

## Acceptance criteria

- [x] **SP-1** With no pack that defines species, the Species select lists only Human and the characteristics
      show no Species column.
- [x] **SP-2** Picking a species shows each characteristic's roll, modifier and modified value, and the UPP
      uses the modified values.
- [x] **SP-3** A modifier that would take a characteristic below the species' `minCharacteristic` gives that
      minimum; one that takes it above 15 keeps the higher value. (Unit test.)
- [x] **SP-4** An override replaces the modified value, and Reset returns to the modified value.
- [x] **SP-5** For a sweep of seeds, the characteristic dice totals and the Finish career dice totals are the
      same for Human and for a species with modifiers. (Unit test.)
- [x] **SP-6** The species picked for a seed is shown again after a reload of that seed's page.
- [x] **SP-7** A saved species that no loaded pack defines shows the missing species notice and the
      characteristics are Human's.
- [x] **SP-8** A pack with one invalid species entry loads its careers and its valid species, and lists the
      invalid entry in the pack's problems.
- [x] **SP-9** The picked species' traits are listed by name and summary under the characteristics.
- [x] **SP-10** Reroll keeps the picked species for the new seed.
- [x] **SP-11** A version 2 pack that lists `species` is rejected with a message that it must say version 3.
- [x] **SP-12** The Career section's qualification DM uses the modified characteristic value.
- [x] **SP-13** Seeds named `__proto__` and `constructor` save and read their species like any other seed, and
      opening `./?seed=__proto__` shows the page with Human picked.
- [x] **SP-14** A saved entry that isn't a species id doesn't remove other seeds' saved species, and saving a
      species for one seed keeps every other entry. (Unit test.)
- [x] **SP-15** A species with `minCharacteristic` leaves a characteristic it doesn't modify at its dice total,
      even when that total is below the minimum. (Unit test.)
- [x] **SP-16** Changing species removes an override equal to the new modified value, so changing back shows
      that species' modified value with no override.
- [x] **SP-17** Reroll with a saved species that no loaded pack defines gives the new seed Human, with no
      missing species notice.
- [x] **SP-18** When saving the species fails, a notice says it could not be saved in this browser.

## Open questions

None. Buddy's answers on 2026-11-04 are recorded above.
