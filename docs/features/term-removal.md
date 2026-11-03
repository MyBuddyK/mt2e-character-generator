# Removing the most recent term

Status: built.

## Problem

A player who doesn't like how a term went, or who clicked Continue in career by mistake, has no way to go
back. Overrides change single rolls, but they can't undo a whole term. Players need to remove the most
recent term, then remove the one before it if they want, and carry on from the end of whichever term is
now the most recent.

## Decisions

1. **Only the most recent term can be removed.** The last term of the character, across every career, has a
   **Remove term N** button under its notes field. Earlier terms have none. After a removal the term
   before it becomes the most recent and gets the button, so terms can be removed one at a time back to
   the first.

2. **Removing a term goes back to the end of the term before it.** The character is a seed plus choices
   and overrides (career-terms.md, decision 3), so removal is a change to that input, not to the built
   character. The engine function `removeLastTerm` deletes the after-term choice of the term before the
   removed one, so the rebuilt career stops there with Continue in career, Leave career (or Muster out)
   and Finish career offered again. Every choice and override the rebuilt career no longer reads is then
   dropped: the removed term's own choices and overrides, and any mustering out and later careers that
   came after it. Everything the removed term added (skills, characteristic changes, rank, age, aging,
   anagathics costs, event DMs and connection opportunities) is gone because the character is rebuilt
   without it.

3. **Removing the first term goes back to the career pick.** There is no term before it, so every choice
   and override is removed and the Start career form is shown again.

4. **Notes for the removed term are deleted.** Notes for earlier terms are kept.

5. **A removed term played again gets the same dice.** Each roll's dice come from the seed and the roll's
   path (career-terms.md, decision 4), so continuing after a removal rolls the new term with the same dice
   as the removed one. Choices and overrides made in the removed term are not kept, so the player can make
   different ones. Re-rolling a term with new dice is not part of this feature.

6. **A notice says what was removed.** After a removal, a line says which term was removed and which term
   the character is back at the end of (or that the career pick is next). The next change clears it.

7. **There is no confirmation and no undo.** The removal is saved straight away, like every other change.

## Acceptance criteria

- [x] **TR-1** Only the most recent term shows a Remove term button.
- [x] **TR-2** Removing the most recent term gives the same character as stopping at the end of the term before
      it: the same terms, skills, characteristic changes, age, rank and cash, with the after-term choice pending.
- [x] **TR-3** After a removal, the new most recent term can be removed, one term at a time back to the first.
- [x] **TR-4** Removing the first term removes every choice and override and shows the career pick again.
- [x] **TR-5** After a removal, Continue in career, Leave career and Finish career go on from the end of the new
      most recent term.
- [x] **TR-6** Removing a term after mustering out removes the mustering out, and any later career.
- [x] **TR-7** Removing a term deletes that term's choices, overrides and notes and keeps those of earlier terms,
      and the result is still there after a reload.
- [x] **TR-8** After a removal, a notice names the removed term and the term the character is back at.
