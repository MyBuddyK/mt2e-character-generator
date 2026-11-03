# Career terms (step 2)

Status: proposed. Nothing in this spec is built yet.

## Problem

Today the app rolls characteristics and lists careers, but a character can't enter a career. Players need
to take a character through terms one at a time at the table, stopping after each term to talk about events
that could tie their characters together. They also need a way to finish the rest of a character in one
click, and to change any roll or choice the generator made.

## Scope and order

Step 2 is split into two pull requests. This document covers part 1 in full. Part 2 is planned and is
listed here only so part 1 doesn't block it.

1. **Part 1 (this spec): one career, term by term.** Qualification, basic training, skill rolls, survival,
   events, mishaps, advancement and rank bonuses, aging, choosing to continue or leave, and mustering out.
   Step-through, generate-the-rest, overrides for every roll and choice, and highlighted connection
   opportunities.
2. **Part 2 (planned): more than one career.** Leaving one career and qualifying for the next, and the
   fallback when qualification fails. Commissions for careers that have them.

Connections between characters are only highlighted (decision 9). The app does not link characters across
players' browsers, so there is no group code and no server.

## Decisions

1. **The rules numbers come from data, not code.** The career data already holds the targets and tables
   for each career. The values that apply to every career are also data: the starting age, the term
   length, the aging table, how many benefit rolls a character gets, and the cash roll limit. They go in a
   new optional `rules` object in a career pack, checked by a new zod `RulesSchema`. The repo ships an
   invented `sample-rules.json` next to the sample career, so the public site works without a pack. A
   pack without `rules` uses the sample rules, and the app says so. No value from a rulebook is written in
   code or in the repo.

2. **Event and mishap effects are notes unless the data says otherwise.** Each event entry keeps its
   `summary`. An entry can also list structured `effects` that the engine applies, from a short fixed list:
   - `skill`: gain a level in a named skill, or in one of a list the player picks from
   - `roll-table`: roll once on one of the career's skill tables
   - `dm-next`: a DM on the next advancement or qualification roll
   - `benefit-dm`: a DM on one mustering-out benefit roll
   - `extra-benefit`: one extra mustering-out benefit roll
   - `characteristic`: a change to one characteristic
   - `leave-career`: the character leaves the career at the end of this term
   - `mishap`: roll on the mishap table without leaving the career

   The owner chose structured effects on 2026-11-03. An entry with no `effects`, or with effects that need
   judgement, is shown as a note. The player applies
   it by hand with the override controls and can type what happened in a free-text field on that term.
   Older packs without `effects` still load.

3. **A character is a seed plus a list of choices and overrides.** The engine rebuilds the whole character
   from these each time anything changes, with a pure function `buildCharacter(seed, choices, overrides,
   data)`. Choices are what the player decides (career, assignment, which skill table to roll on, whether
   to continue, cash or benefit). Overrides replace a single roll or result. The URL holds the seed; the
   choices and overrides are saved in the browser, like career packs, and can be exported later with the
   Foundry export (step 3).

4. **Each roll has its own dice stream.** A roll's dice come from a seed made of the character seed plus
   the roll's place, for example `seed:term-3:survival`. Overriding one roll then changes only what follows
   from it, not every later roll. If an override makes a later step disappear (for example the character
   now fails survival, so there is no advancement roll), that step and its overrides are dropped, and the
   term shows that it changed.

5. **Every roll is shown as rolled value, modifiers and result, and each part can be overridden.** This
   follows the existing `Overridable<T>` pattern: the UI shows the rolled dice and, when overridden, the
   override and a Reset button. Overriding the dice of a check recomputes whether it passed. Overriding
   the pass or fail directly is also allowed, for a referee ruling.

6. **Step-through pauses after every term.** After each term the app stops and shows a term summary: the
   rolls, the skills gained, the event or mishap, and a **Connection** marker on events whose data has
   `connection: true`. The player then picks **Continue in career**, **Leave career**, or **Generate the
   rest**. Generate the rest makes the remaining choices with a fixed, seeded policy (decision 7) and stops
   only when the character musters out.

7. **Generate the rest uses a simple, visible policy.** It keeps the current career, picks the assignment
   the player already chose, rolls on the skill table with the highest-numbered entry the character can
   use, continues until the character is forced out or reaches a term limit from `rules`, and takes cash
   for the first benefit roll and benefits after that. The policy is shown in a short note next to the
   button, and every choice it made can be changed afterwards like any other choice.

8. **Mustering out happens once, at the end.** The player rolls each benefit, picking the cash or benefit
   table for each one. Rank bonuses and benefit DMs from events are applied. The result is a list of cash
   and benefit entries, each overridable.

9. **Connections are highlighted, and the players work them out.** Events and mishaps whose data has
   `connection: true` get a Connection marker in the term summary. The finished character also has a
   **Connection opportunities** list with every marked event, its term and its summary, so players can go
   through them together at the table. The app does not record who a connection is with beyond the term's
   free-text notes.

## User flow

1. The player rolls or adjusts characteristics as today.
2. The player picks a career and an assignment from the loaded careers, and clicks **Start career**.
3. The app rolls qualification. On a failure, the term shows the failure and the player can override the
   roll or pick another career (part 2 adds the fallback).
4. The first term applies basic training, then the player picks a skill table and the app rolls on it.
5. The app rolls survival. On a pass it rolls an event; on a failure it rolls a mishap and the character
   leaves the career after this term.
6. If the character survived, the app rolls advancement and applies any rank bonus.
7. If the character has reached the age where aging applies, the app rolls aging and applies the result.
8. The term summary appears, with connection markers. The player adds notes, changes anything, and picks
   Continue, Leave, or Generate the rest.
9. When the character leaves, the player rolls mustering-out benefits.
10. The finished character shows characteristics, age, skills, rank and title, cash, benefits and the
    term history.

## UI

A **Career** section below the characteristics:

```
Career  Sample: Orbital Sanitation / Debris sweep      [Start career]
──────────────────────────────────────────────────────────────────────
Term 1   age 18-22                                       rank 1 Tug Pilot
  Qualification  END 5+   2D 8 +1 = 9  pass               [override]
  Training       Vacc Suit 0, Pilot 0, Mechanic 0, ...  (from data)
  Skill roll     Service skills  D6 4  Electronics 1     [override]
  Survival       DEX 6+   2D 5 +0 = 5  fail               [override]
  Mishap         D6 3  "..."                              [override]
  Notes          [                                         ]
──────────────────────────────────────────────────────────────────────
[Continue in career]  [Leave career]  [Generate the rest]
Generate the rest keeps this career and assignment, continues until ...
```

States:

- **No career started:** the career and assignment pickers and Start career.
- **Term in progress:** the rolls so far, in order.
- **Paused after a term:** the term summary with connection markers and the three buttons.
- **Forced out:** after a mishap or a leave-career effect, only Leave career and Muster out are offered.
- **Mustering out:** one row per benefit roll with a cash or benefit picker.
- **Overridden:** each overridden roll shows the badge and Reset, as the characteristics do now.
- **Changed by an override:** a term whose later steps were dropped or added shows a notice.
- **Sample rules in use:** a notice that the rules values are invented, shown until a pack with `rules`
  is loaded.

At 320px wide the term rows stack, as the characteristics table does now.

## Engine and data changes

- `src/engine/rules-schema.ts`: `RulesSchema` for the values in decision 1, with each table checked for
  coverage like the career tables.
- `src/engine/career-schema.ts`: an optional `effects` array on event and mishap entries (decision 2).
- `src/engine/career-pack.ts`: an optional `rules` field on a pack. `formatVersion` stays 1 because older
  packs still pass.
- `src/data/rules/sample-rules.json`: invented rules values.
- `src/engine/dice.ts`: `diceFor(seed, path)`, which returns a `Dice` seeded from the seed and the roll's
  path (decision 4).
- `src/engine/terms.ts`: the term types (`Term`, `Step`, `Choice`, `Override`) and `buildCharacter`.
  Each step records its dice, modifiers, target and result as `Overridable` values.
- `src/engine/policy.ts`: the generate-the-rest policy as a function that returns the next choice.
- `src/engine/character.ts`: `Character` gains age, skills, career history, cash and benefits.
- `src/storage/characters.ts`: saves choices, overrides and notes per seed in localStorage, with the
  same failure handling as packs.
- `src/Career.tsx`: the Career section.
- `e2e/fixtures/`: an invented pack with `rules` and with events that use each effect.

## Acceptance criteria

- [ ] With `?seed=terms` and the sample career, Start career shows a first term whose rolls are the same
      on every load.
- [ ] Overriding the survival dice of term 1 to a failing total shows a mishap instead of an event, and the
      advancement roll disappears.
- [ ] Resetting that override brings back the original event and advancement roll.
- [ ] Overriding the survival roll in term 1 does not change the skill roll in term 2.
- [ ] An event with a `skill` effect adds that skill to the character.
- [ ] An event with no `effects` shows its summary and a notes field, and the character is unchanged until
      the player edits it.
- [ ] Events with `connection: true` show a Connection marker in the term summary.
- [ ] The finished character's Connection opportunities list shows each marked event with its term, and
      is empty with a short line when there are none.
- [ ] Continue in career adds a term, and the age goes up by the term length from `rules`.
- [ ] Aging is rolled once the age reaches the threshold in `rules`, and not before.
- [ ] Generate the rest finishes the character and stops at mustering out, and each choice it made can be
      changed.
- [ ] Leave career leads to mustering out with the number of benefit rolls given by `rules`.
- [ ] Each benefit roll can switch between cash and benefit, and the cash total stays within the limit in
      `rules`.
- [ ] After a reload with the same seed, the choices, overrides and notes are still there.
- [ ] With only the bundled data loaded, the sample rules notice is shown.
- [ ] At 320px wide the page does not scroll sideways with three terms shown.
- [ ] The Career section can be used with the keyboard alone.

## Resolved questions

Answered by the owner on 2026-11-03:

1. **Event effects:** events carry a short list of structured effects that the app applies (decision 2).
2. **Connections:** the app only highlights connection opportunities; players work them out themselves
   (decision 9). No group code. Group codes are a possible future feature, tracked in a GitHub issue.
3. **Saving characters:** links don't restore a character. The URL holds only the seed and `?packs=`;
   choices, overrides and notes stay in the player's browser (decision 3).
