# Prisoner and Psion careers

Status: Prisoner built; Psion planned.

## Problem

Buddy decided on 2026-11-04 that Prisoner and Psion become careers in the career pack, with the engine rules
they need. Neither can be picked at the career pick: an event, a Life Event or a pre-career event sends the
character there with a `next-career` effect (docs/features/education.md). Prisoner also changes how a career
ends: a Parole Threshold decides when the character leaves, and mishaps don't end the career. Psion adds a PSI
characteristic and talent rolls, and is planned for a later change.

Rulebook values (the Prisoner and Psion tables, the parole dice) go only in the private career pack. The repo
has invented test data in `e2e/fixtures/prisoner-pack.json`.

## User flow (Prisoner)

1. An event with a `next-career` effect naming a forced-entry career ends the career after the term. After
   mustering out, the forced career starts with no qualification roll, as any `next-career` career does.
2. Term 1 of a career with `parole` rolls the Parole Threshold after basic training.
3. Event and mishap effects raise, lower or roll the Parole Threshold again.
4. At the end of each term, an advancement total above the Parole Threshold ends the sentence: the career
   ends and the character musters out. Otherwise the character must continue.
5. With `assignmentEachTerm`, each term after the first starts by asking for the assignment.

## UI

- **Career pick**: a career with `"entry": "forced"` is not listed.
- **Parole step**: labelled "Parole Threshold", with the dice, the added value and the result, and the cap as a
  reason when it applies.
- **Parole effects**: the step that gave the effect lists "Parole Threshold +2 (now 7)" or similar. Rolling
  again adds a "Parole Threshold (rolled again)" roll step, and lowering by dice a "Parole Threshold
  (lowered)" step.
- **Parole check**: after an automatic promotion or a commission, an "Advancement (parole)" roll.
- **Anagathics**: a career with `anagathics: false` shows no Anagathics box on its terms.
- **After the term**: the forced choice gives the reason: "Advancement 9 is above the Parole Threshold 7, so
  the sentence ends after this term." or "Advancement 5 is not above the Parole Threshold 7, so the character
  must continue." After a failed survival: "Survival failed, so there is no advancement roll this term and the
  character must continue."
- **Assignment each term**: the assignment pick as for the Draft, and an "Assignment" step in the term naming
  the assignment picked.

## Decisions

1. **`entry: "forced"` hides a career from the career pick.** A saved `start.career` naming it is a problem
   ("<career> can be entered only when an event sends the character there.") and the career pick is asked
   again. `next-career` and a Draft row can still name it. Its `qualification` is still required by the
   schema; it is not rolled when an event sends the character there.
2. **`parole` is `{ dice, plus, max }`.** The Parole Threshold is `dice`D + `plus`, capped at `max`. It is
   rolled at `<term-1>.parole`, after basic training and rank 0, and kept for the rest of the career.
3. **A parole career ends only by parole or an effect.** At the end of a term with an advancement roll, a
   total above the Parole Threshold forces muster out; any other total forces continue. The natural-roll
   stay rule and the leave-at-or-below-terms rule in `rules.advancement` don't apply, and neither does the term
   limit Finish career uses. A `leave-career` or `next-career` effect still ends the career after the term.
   Promotion still uses the assignment's advancement target. A term with an automatic promotion (`promote`)
   or a commission has no advancement total, so it rolls the assignment's advancement check once more, at
   `<term>.parole-check`, only to compare with the Parole Threshold.
4. **A failed survival in a parole career doesn't end it.** The mishap is rolled as "Mishap (keeps the job)",
   the term keeps its benefit roll, there is no event and no advancement roll, and the character must
   continue.
5. **Three parole effects.** `parole` (`change`, a whole number) adds to the threshold; `parole-reroll` rolls
   it again with the career's `parole` dice; `parole-lower-dice` (`dice`, 1 to 3) lowers it by that many D.
   Each result is capped at `max`; there is no lower limit. Outside a career with `parole` each is a note.
6. **`anagathics: false` offers no anagathics in that career**, and its terms show no Anagathics box. A character who took anagathics in the term
   before stops, with the aging roll that stopping gives.
7. **`assignmentEachTerm: true` asks for the assignment each term after the first**, at
   `<term-n>.assignment`. The rank is kept; the title is the new assignment's title of the highest rank at or
   below it that has one, or none. Finish career keeps the current assignment.
8. **Not covered**: a DM on every later survival roll in the career (the gang event) and the lawyer's cost.
   The pack keeps these in the entry's summary, for the player to apply by hand.

## Psion (planned)

Planned, not built: a forced-entry Psion career, a PSI characteristic rolled when first tested (2D minus the
terms served), talent rolls with a DM per talent and -1 per earlier attempt, Telepathy as a first talent with
no roll, and basic training from the assignment table. Its criteria are added when it is built.

## Engine and data changes

- `src/engine/career-schema.ts`: `entry`, `parole`, `anagathics` and `assignmentEachTerm` on `CareerSchema`.
- `src/engine/effects.ts`: the `parole`, `parole-reroll` and `parole-lower-dice` effects.
- `src/engine/terms.ts`: `canPick`, the rule the engine and the career pick share for which careers can be
  picked; the career pick check, the parole roll, the parole effects, the end-of-term rule,
  survival in a parole career, anagathics, and the assignment each term. `CareerRun.parole` holds the current
  Parole Threshold. The `assignment` pending choice has `keep`, the assignment Finish career keeps.
- `src/engine/policy.ts`: Finish career answers an `assignment` choice that has `keep`.
- `src/Career.tsx`: the career pick leaves out forced careers (with `canPick`), and a career with
  `anagathics: false` shows no Anagathics box.
- `e2e/fixtures/prisoner-pack.json`: an invented career whose roll 8 event sends the character to an invented
  prison career, and the sample rules with invented anagathics values.

## Acceptance criteria

- [x] **PP-1** A career with `"entry": "forced"` is not listed at the career pick, and a saved pick of it adds a
      problem and asks for the career pick again.
- [x] **PP-2** A `next-career` effect naming a forced career starts it with no qualification roll.
- [x] **PP-3** Term 1 of a career with `parole` rolls the Parole Threshold after basic training as `dice`D +
      `plus`, capped at `max`. (Unit test.)
- [x] **PP-4** A `parole` effect adds its change, capped at `max`; `parole-reroll` rolls the threshold again;
      `parole-lower-dice` lowers it by its dice. (Unit test.)
- [x] **PP-5** A parole effect outside a career with `parole` adds a note and changes nothing. (Unit test.)
- [x] **PP-6** An advancement total above the Parole Threshold forces muster out after the term; a total at or
      below it forces continue, whatever the natural roll and the terms served.
- [x] **PP-7** A failed survival in a parole career rolls a mishap that keeps the job and the benefit roll, rolls
      no event and no advancement, and forces continue. (Unit test.)
- [x] **PP-8** A `leave-career` effect in a parole career ends it after the term. (Unit test.)
- [x] **PP-9** A career with `anagathics: false` asks no anagathics choice, and a character on anagathics in the
      term before rolls the stopping aging roll. (Unit test.)
- [x] **PP-10** With `assignmentEachTerm`, each term after the first asks for the assignment, keeps the rank,
      and adds an Assignment step; Finish career keeps the current assignment. (Unit test.)
- [x] **PP-11** Finish career in a parole career continues until the Parole Threshold is beaten. (Unit test.)
- [x] **PP-12** In a career with `parole`, a term with an automatic promotion rolls an Advancement (parole)
      check, and its total against the Parole Threshold ends or continues the career. (Unit test.)
- [x] **PP-13** A career with `anagathics: false` shows no Anagathics box on its terms, while a career before it
      does.
