# Event and mishap choices

Status: built.

## Problem

Many events and mishaps let the player pick what happens: gain a skill or take a DM on the next
advancement roll, accept or refuse an offer, report someone or keep quiet. Until now a career pack could
only list effects that always apply, or a skill choice, so these entries were left as notes for the player
to apply by hand. Buddy asked on 2026-11-03 for the app to ask the player for the selection, and for a
forward DM that the player picks to be applied automatically or by hand, depending on the entry.

## Decisions

1. **A `choice` effect lists the options.** An event, mishap, rank or aging entry can have
   `{ "type": "choice", "options": [{ "label": "...", "effects": [...] }, ...] }`, with at least two
   options and each label used once. When the engine reaches it, the build stops and asks the player
   which option to take; the answer is stored under `<entry key>.effect-<n>.choice` as the option's
   label. Only the picked option's effects are applied, and the step says which option was chosen. An
   option with no `effects` does nothing the app tracks (for example "gain an Ally", which stays in the
   entry summary). An option can list any effect except another `choice`.

2. **Choices on a mishap can keep the career or the benefit roll.** A mishap that ends the career sets
   the end of the career and, with `rules.benefits.mishapLosesTerm`, the lost benefit roll before its
   effects are applied. A `stay-in-career` effect picked in a choice undoes the mishap's end of the career
   and gives back the benefit roll, as it does when listed outside a choice. It does not undo an end set by
   another effect, such as a `leave-career` on the same entry. A `keep-benefit` effect picked in a choice
   gives back the benefit roll. Listed outside a choice, both work as before.

3. **A forward DM whose roll is clear is applied by the engine.** `dm-next` names the roll:
   `advancement`, `qualification`, or (new) `survival`. The engine adds the DM to the next roll of that
   kind, and that roll gives the reason ("DM +4 from an event."). An advancement DM goes on a commission
   roll when the player tries for one, and that roll uses it up whether it passes or fails, so the
   advancement roll after a failed commission doesn't get it again. A survival DM goes on the term's first
   survival roll, not on the second roll for anagathics. `benefit-dm` keeps going on the next roll on the
   benefit table.

4. **A forward DM whose roll the player decides is applied by hand.** `dm-later` is for entries such as
   "DM+4 to an advancement roll" or "DM+1 to one roll", where the book leaves the roll to the player. It
   has a `dm` and an optional list of roll kinds (`qualification`, `survival`, `advancement`,
   `commission`, `aging`, `benefit`; any of them when left out). The step that gave it shows a select
   listing each roll of those kinds rolled after it. Picking one adds the DM to that roll, which gives
   the reason ("DM +4 from Term 2 Event, applied by the player."); Not applied takes it off. The pick
   is stored under `<entry key>.effect-<n>.apply` as the roll's step key. A pick whose roll is no longer
   built (after an override or a removed term) is dropped like any other choice. The player can pick a
   roll after seeing its dice, the same way an override can change any roll.

5. **Which form a pack uses is the pack author's call.** The app does not read the summary text. For the
   Core Rulebook pack, "DM+4 to your next advancement roll" fits `dm-next`, and "DM+4 to an advancement
   roll" fits `dm-later` with `["advancement"]`. Updating the private pack is separate from this change.

6. **Finish career picks options at random and leaves `dm-later` unapplied.** It picks a choice option
   with the seed, the same way it picks a skill option, so a seed gives the same pick each time. It does
   not apply a `dm-later` DM. The finished summary lists every `dm-later` DM that was not applied, and any
   `dm-next` advancement or survival DM that no roll used.

## UI

- A pending choice shows the step and its summary ("Event: ... Choose one:"), a button for each option
  label, and Finish career.
- A step with a `dm-later` DM shows "DM +4 for one later advancement roll, applied by hand:" and a select
  named "<term> <step> DM +4 applies to", with Not applied and each roll it can go on. Before any such
  roll has been rolled, it says to pick the roll once it has been rolled.
- The finished summary has a "DMs not applied" line when any `dm-later` DM was not applied or a `dm-next`
  advancement or survival DM is left over.

## Acceptance criteria

- [x] **EC-1** The schema accepts a `choice` with two or more options with different labels, `dm-later` with
      or without roll kinds, and `dm-next` on survival; it rejects a choice with one option, a label used
      twice, a choice inside a choice, an empty roll kind list and an unknown roll kind.
- [x] **EC-2** A `choice` on an event or mishap stops the build with the choice pending, naming the step, its
      summary and the option labels. A saved answer that is not one of the labels asks again.
- [x] **EC-3** Picking an option applies only that option's effects, and the step says which option was chosen.
- [x] **EC-4** On a mishap, an option with `stay-in-career` keeps the career going, and an option with
      `keep-benefit` gives back the term's benefit roll. `stay-in-career` in a choice also keeps the benefit roll
      and does not undo a `leave-career` on the same entry.
- [x] **EC-5** A `dm-next` DM, picked in a choice or not, goes on the next roll of its kind (advancement or
      survival here), and that roll gives the reason. A failed commission roll uses up an advancement DM, and a
      survival DM goes on a term's first survival roll only.
- [x] **EC-6** A `dm-later` DM is not applied until the player picks a later roll of its kinds; then it goes on
      that roll, which gives the reason.
- [x] **EC-7** A `dm-later` pick that names a roll not offered (wrong kind, or not built) is not applied and is
      removed from the saved choices.
- [x] **EC-8** Finish career picks a choice option from the seed and leaves `dm-later` DMs unapplied, and the
      finished summary lists them with any `dm-next` DM left over.
- [x] **EC-9** In the browser, a choice shows a button per option; picking the DM option puts the DM on the
      advancement roll, and a held DM can be applied to a later roll with its select.
