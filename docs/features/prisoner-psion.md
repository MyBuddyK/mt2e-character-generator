# Prisoner and Psion careers

Status: built.

## Problem

Buddy decided on 2026-11-04 that Prisoner and Psion become careers in the career pack, with the engine rules
they need. Neither is open to every character. An event sends a character to Prisoner with a `next-career`
effect (docs/features/education.md), and Prisoner changes how a career ends: a Parole Threshold decides when
the character leaves, and mishaps don't end the career. Psion opens only after an event tests the
character's PSI, a seventh value most characters never roll, and it adds talent rolls.

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

## Psion

### User flow

1. An event, Life Event or pre-career event with a `psi-test` effect rolls the character's PSI.
2. From the next career pick on, careers with `"entry": "psi-tested"` are listed. Their qualification can be a
   PSI check, with the usual DM for earlier careers.
3. Term 1 of a career with `talents` starts with the talent rolls: the player picks the order, and each talent
   the character lacks is rolled once.
4. In that career, a skill gain that names a talent the character lacks is a talent roll instead.

### UI

- **PSI test step**: labelled "PSI test", with the 2D roll, the DM for terms served and the PSI value.
- **Career pick**: a `psi-tested` career is listed once PSI is tested.
- **Talent rolls**: a "Talent: <name>" roll for each talent, or "Talent: <name> (automatic)" with no roll,
  and a pick of the next talent to try.
- **Finished summary and the summary line**: "PSI <n>" once PSI is tested.

### Decisions

9. **PSI is a seventh value only for a tested character.** It is not in the UPP, the rolled characteristics
   or species modifiers. `CareerResult.psi` is its current value, or undefined until it is tested.
10. **`psi-test` rolls PSI once.** It rolls 2D at `<effect key>.psi` and subtracts the terms finished before
    the current term, education terms included, with 0 as the lowest value (the step then says so). A second
    `psi-test` is a note.
11. **`"entry": "psi-tested"`** lists a career at the career pick only once PSI is tested. A saved pick of it
    before that is a problem, as for a forced career. Before a PSI test, a `next-career` effect naming one is
    a note and changes nothing, and a Draft row naming one is a problem that asks for the career pick, as for
    a Draft career that isn't loaded.
12. **PSI in checks.** `PSI` can be the characteristic of a qualification, survival, advancement or
    commission check, and an option of a `check` effect. It uses the PSI DM; an untested PSI counts as 0.
13. **PSI changes.** A `characteristic` effect or a skill table entry such as "PSI +1" changes PSI, with 0 as
    the lowest value. Before PSI is tested it is a note and changes nothing.
14. **`talents` is `{ target, attemptDM, automaticFirst?, list }`**, where `list` holds `{ name, dm }`. In term 1
    of the career, before basic training, the player picks which talent to try next at
    `<term-1>.talents.pick-<i>` from the listed talents the character lacks and has never tried (so a
    character who joins the career again tries none twice), until none are left; the last one needs no
    pick. Each is rolled at `<term-1>.talents.roll-<i>`: 2D + the PSI DM + the talent's `dm` + `attemptDM` for each talent
    roll made before it, against `target`. A pass gives the talent at level 0. `automaticFirst`, when it is
    the first talent picked, is gained with no roll and doesn't count as a roll made. Finish career picks
    `automaticFirst` first when it is offered, then tries the others in the listed order.
15. **A talent from a skill gain is a talent roll.** In a career term with `talents`, a skill gain (from a
    skill table, an event or a rank) naming a listed talent the character lacks rolls for it at
    `<step key>.talent-<n>` first, where `n` counts the talent rolls of that step from 0, as in decision 14; a
    pass applies the gain, a fail gives nothing. It counts as a talent roll for the DM of later ones. A gain
    the skill limits block is lost before any talent roll. Basic training gives no talent the character
    lacks, since term 1 has just rolled for each one: a later career's basic training pick leaves those
    talents out, and a pick between options leaves them out while another option is left.
16. **Not covered**: a Psionics Institute outside a career (its cost and its training), and changing
    assignment by qualifying again. The pack keeps these in summaries, for the player to apply by hand.

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
- Psion: `src/engine/characteristics.ts` (`CHECK_CHARACTERISTICS`, the six and `PSI`); `career-schema.ts`
  (`"entry": "psi-tested"`, `talents`, PSI in checks); `effects.ts` (`psi-test`, PSI in `characteristic` and
  `check`); `terms.ts` (the PSI value, the talent rolls, `CareerResult.psi`); `policy.ts` (the talent pick);
  `Career.tsx` (the talent pick and PSI in the summary); `e2e/fixtures/psion-pack.json`.
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
- [x] **PP-14** A `psi-test` effect rolls 2D minus the terms finished before the current term, at least 0, and a
      second one is a note. (Unit test.)
- [x] **PP-15** A `psi-tested` career is offered at the career pick only after a PSI test, and a saved pick of it
      before then is a problem.
- [x] **PP-16** A PSI qualification check uses the PSI DM and the DM for earlier careers. (Unit test.)
- [x] **PP-17** A PSI change from an effect or a skill table entry changes PSI after a test, and is a note before
      one. (Unit test.)
- [x] **PP-18** Term 1 of a career with `talents` asks for the talent order and rolls each talent the character
      lacks with the PSI DM, its DM and `attemptDM` per earlier roll; `automaticFirst` picked first passes
      with no roll. (Unit test.)
- [x] **PP-19** In a career with `talents`, a skill gain naming a talent the character lacks rolls for it first,
      and gives nothing on a fail. (Unit test.)
- [x] **PP-20** Finish career tries the talents in the listed order. (Unit test.)
- [x] **PP-21** The finished summary shows PSI once it is tested.
- [x] **PP-22** Two talent rolls from skill gains on one step have their own keys and dice. (Unit test.)
- [x] **PP-23** A character who joins a career with talents again rolls no talent in term 1 that was rolled for
      before. (Unit test.)
- [x] **PP-24** Basic training in a career with talents gives no talent the character lacks, rolls for none, and
      leaves those talents out of a later career's basic training pick. (Unit test.)
- [x] **PP-25** A `next-career` effect naming a `psi-tested` career before a PSI test is a note, and a Draft row
      naming one is a problem that asks for the career pick. (Unit test.)
- [x] **PP-26** A skill gain that the skill limits block makes no talent roll. (Unit test.)
- [x] **PP-27** Finish career picks `automaticFirst` first when it is offered, wherever it is listed. (Unit test.)
