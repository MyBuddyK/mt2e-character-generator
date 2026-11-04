# Life Events

Status: built.

## Problem

Many career and pre-career event tables have an entry that says "Life Event": roll on the Life Events table
and apply what it says. Until now a career pack could only show that entry as a note for the player to
roll by hand. Buddy asked on 2026-11-04 for a Life Events table in the career pack, resolved inline on the
term that rolled it, and for a default entry, "Passes Go! Collects two ship shares.", when no career pack
with rules is loaded.

## User flow

1. A term's event (or mishap, rank or aging entry) has a `life-event` effect.
2. The term shows a Life Event step right after that step, with the 2D roll, the Life Events entry and what
   it applied. An entry with a sub-table (such as an unusual event) shows a second step with the 1D roll.
3. The player can override the Life Event dice like any other roll, and picks any choice the entry offers.
4. With no career pack loaded, the sample rules' one-row table always gives "Passes Go! Collects two ship
   shares.", and the finished summary shows the ship shares.

## UI

- **Life Event step**: labelled "Life Event", with the dice, the entry summary, applied effects and notes,
  like an event step. An entry marked `connection` shows the connection badge.
- **Sub-table step**: labelled "Life Event: <entry summary>", with a 1D roll.
- **Finished summary**: "ship shares N" after cash, shown only when N is above 0.

## Decisions

1. **The table is part of the rules.** `rules.lifeEvents` is `{ "dice": 2, "table": [...] }`. Each row has a
   `roll`, a `summary`, optional `connection` and `effects`, and an optional `subTable` of 1D rows with the
   same fields (no further sub-table). Rows must be consecutive, each once. Totals outside the table use the
   nearest row, as the aging table does. No pack format version change: `rules` and effects already need
   version 2 or later.
2. **A `life-event` effect rolls inline.** The roll's key is `<entry key>.effect-<n>.life-event` and the
   sub-table's is that key plus `.sub`, so each has its own dice stream from the seed. The Life Event's
   effects are applied with the same rules as an event's, in the same term.
3. **One Life Event per entry.** A `life-event` effect inside a Life Event entry is a note for the player to
   roll by hand, so a table can't loop.
4. **No table, no roll.** When the rules have no `lifeEvents`, a `life-event` effect adds a note to roll by
   hand.
5. **Ship shares are counted.** A `ship-shares` effect (`count` at least 1) adds to the character's ship
   shares. A mustering-out row can set `shipShares` (at least 1), which is added when that row is taken as a
   benefit (not as cash). Ship shares that a benefit names only in its text are not counted.
6. **The sample rules have a default.** `src/data/rules/sample-rules.json` has the same invented entry, "Passes
   Go! Collects two ship shares.", with a `ship-shares` effect of 2, on every row from 2 to 12, so no 2D total
   is out of range. The invented sample career's roll 7 event has a `life-event` effect, and its "Ship share"
   and "Two ship shares" benefits set `shipShares`.
7. **A Life Event is not part of a mishap.** When a mishap's entry rolls a Life Event, the Life Event's
   `stay-in-career` and `keep-benefit` effects don't undo the mishap.
8. **Sub-table rows are 1 to 6**, since the sub-table is rolled on 1D.

## Engine and data changes

- `src/engine/effects.ts`: the `life-event` and `ship-shares` effects.
- `src/engine/rules-schema.ts`: `rules.lifeEvents`, `LifeEventEntrySchema` and `LifeEventSubEntrySchema`.
- `src/engine/career-schema.ts`: optional `shipShares` on mustering-out rows.
- `src/engine/terms.ts`: the Life Event roll and `shipShares` on the career result.
- The private Core Rulebook pack gets its Life Events table and `life-event` effects on its "Life Event"
  entries as a separate pack revision.

## Acceptance criteria

- [x] **LE-1** A `life-event` effect on an event adds a Life Event step right after the event step, with the
      roll, the entry's summary and its applied effects.
- [x] **LE-2** Overriding the Life Event dice changes the row used and nothing rolled before it. (Unit test.)
- [x] **LE-3** A total outside the table uses the nearest row and the step is marked out of range. (Unit test.)
- [x] **LE-4** A row with a `subTable` adds a second step with a 1D roll on it and applies that row's effects.
      (Unit test.)
- [x] **LE-5** With no `rules.lifeEvents`, a `life-event` effect adds a note to roll by hand and no step.
      (Unit test.)
- [x] **LE-6** A `life-event` effect inside a Life Event entry adds a note and no second Life Event roll.
      (Unit test.)
- [x] **LE-7** With no career pack loaded, the sample career's roll 7 event shows a Life Event step with "Passes
      Go! Collects two ship shares."
- [x] **LE-8** `ship-shares` effects add to the character's ship shares, and the finished summary shows them
      only when there is at least one.
- [x] **LE-9** A `choice` on a Life Event entry stops for the player's pick, and Finish career picks one from
      the seed.
- [x] **LE-10** Removing a term removes its Life Event and the ship shares it gave. (Unit test.)
- [x] **LE-11** A Life Events table whose rolls are not consecutive, or whose sub-table rolls are not, fails
      `RulesSchema`. (Unit test.)
- [x] **LE-12** With the sample rules, every Life Event total from 2 to 12 gives "Passes Go! Collects two ship
      shares." and no step is out of range. (Unit test.)
- [x] **LE-13** A Life Event rolled from a mishap's entry can't undo the mishap with `stay-in-career` or
      `keep-benefit`. (Unit test.)
- [x] **LE-14** A mustering-out benefit row with `shipShares` adds that many ship shares when taken as a
      benefit, and none when the same roll is a cash roll. (Unit test.)
- [x] **LE-15** A Life Events sub-table row whose roll is below 1 or above 6 fails `RulesSchema`. (Unit test.)
