# Seed controls

Status: built.

## Problem

Players share a seed so that everyone at the table sees the same character. Before this change the seed was shown
as small text next to the UPP, so a player had to select it by hand to share it, and the only way to drop it was
Reroll or editing the address bar. The owner asked for buttons at the top of the page to clear and copy the seed.

## Decisions

1. **Where.** The seed and both buttons sit in the page header, under the title, so they are the first controls on
   the page. The seed is no longer repeated next to the UPP.
2. **Copy seed copies the seed text only**, not the whole link. The link already holds the seed in `?seed=`.
3. **Clear seed does what opening the page without `?seed=` does**: it picks a new random seed, writes it to the
   address bar and rolls a new character. Characteristic overrides belong to the old character and are gone.
   Career input saved for the old seed stays in `localStorage`, so opening the old seed's link again shows it.
   The result is the same as Reroll, and both buttons call the same function. Clear seed is placed with the seed
   so players find it there. Its accessible description reads "Starts a new character with a new random seed."
4. **Feedback.** After Copy seed the header shows "Seed copied." in a polite live region. When the browser has no
   Clipboard API or refuses the write, it shows a message asking the player to copy the seed by hand. A message is
   shown only while its seed is still the current seed, and is removed 4 seconds after it appears. Each click
   renders a new message element, so a second click is announced again.
5. **Announcing the seed.** The seed is in a polite live region, so a new seed from Reroll or Clear seed is
   announced.

## Acceptance criteria

- [x] **SC-1** The seed shown in the header matches the `?seed=` value in the address bar.
- [x] **SC-2** Clicking Copy seed writes the shown seed to the clipboard and shows "Seed copied."
- [x] **SC-3** When the clipboard write is refused, Copy seed shows a message asking the player to copy the seed by
  hand.
- [x] **SC-4** Clicking Clear seed replaces the seed in the address bar and in the header with a new random seed and
  removes characteristic overrides.
- [x] **SC-5** After Clear seed, any copy message from the old seed is no longer shown.
- [x] **SC-6** Clear seed keeps the career input saved for the old seed: opening the old seed's link again shows it.
- [x] **SC-7** On a page with no Clipboard API, Copy seed shows the message asking the player to copy the seed by
  hand.
- [x] **SC-8** Clicking Clear seed while a copy is still in progress shows no copy message for the new seed.
- [x] **SC-9** The copy message is removed 4 seconds after it appears.
- [x] **SC-10** The seed shown in the header is inside a polite live region.
