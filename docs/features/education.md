# Pre-career education

Status: built.

## Problem

Buddy asked on 2026-11-04 for players to have the option of starting with higher education: a university or
a military academy, taken as a term in place of a career term, before the first career. The book's rules for
pre-career education need things the career engine can't do yet. The pre-career events table has entries
that fail graduation, that ask for a characteristic or skill check with a result for each outcome, and that
send the character to a set career (Prisoner, Drifter, Psion or the Draft) next term. Career and Life Events
entries use the last two as well, so they are built first as effects any entry can use.

Rulebook values (entry and graduation targets, DMs, skill lists, the events table) go only in the private
career pack. The repo has invented samples.

## User flow

1. While the term number is at or below `rules.preCareer.lastTerm`, the career pick also lists each education
   entry the loaded packs define.
2. Picking one rolls entry. A failed entry returns to the career pick for that term.
3. An entered education gives its skills, rolls once on its events table and then rolls graduation, unless an
   event failed graduation or sent the character to a set career.
4. Graduation (with or without honours) gives its benefits. Some are bonuses that the next career start uses:
   a qualification DM, a commission roll before the first term, or automatic entry to a tied career.
5. The next term is a career pick, as after any career. With no career pack loaded, two invented sample
   schools are offered: a trade school (a `pick` education) and an academy tied to the sample career.

## UI

- **Check step**: labelled "Check: <skill or characteristic>", with the 2D roll, the DM, the target and pass
  or fail, then what the pass or fail effects applied.
- **Forced career**: the next career has a "not rolled" qualification step that says an event sent the
  character there, and a notice: "An event sent the character to <career>." For the Draft, the notice also
  names the career drafted into.
- **Career pick**: the Career select lists careers and, in an "Education" group, the education entries that
  can be picked for the term. Picking one hides the Assignment select and the button reads "Start education".
- **Education block**: an "Education" heading, the school's name, the entry roll, and when entry passed the
  education term with the same step list as a career term (with the school's name in place of the rank). Under
  it: "Graduated.", "Graduated with honours.", "Did not graduate." or, for a failed entry, "Entry to <school>
  failed. Pick a career for this term." Bonuses graduation gives the next career are listed under "Bonuses for
  the next career".
- **Finished summary**: "Education: <school> (<outcome>)" for each education term.

## Decisions

1. **`check` is one roll with one of several options.** `options` lists skill names or characteristic names.
   A characteristic uses its DM; a skill uses its level, or -3 untrained, as the `wager` effect does. With more
   than one option the player picks one (Finish career picks one from the seed). `pass` and `fail` are effect
   lists applied after the roll; they can't hold a `check` or a `choice`, so a check can't nest. Each outcome
   has its own key prefix (`….check.pass` and `….check.fail`), so a pick saved for one outcome is never read
   by the other. A characteristic option must be in capitals; `Int` fails the schema rather than being read as
   a skill.
2. **`fail-graduation` belongs to education.** Outside an education term it is a note and changes nothing.
3. **`next-career` ends the career and sets the next one.** The term's career ends after it (the after-term
   choice is forced to muster out), the character musters out as usual, and the next career starts with no
   career pick and no qualification roll. `career` is a career id, or `"draft"` for the Draft, which is rolled
   even when the character was drafted before. A career that no loaded pack has, or `"draft"` with no Draft
   table in the rules, is a note. So is a `next-career` naming the current career, since a career can't be
   entered again straight after it, and one applied outside a career term. When the forced Draft names a
   career that no pack has, the app lists the problem and the player picks the next career as usual. When
   one term has two `next-career` effects, the last one applied is used.
4. **Finish career stops at a forced career.** It plays out the career that rolled `next-career`, musters out,
   and stops when the forced career has started.
5. **Education is pack data.** Pack format version 3 has an optional `education` array, checked by
   `EducationSchema`, and `rules.preCareer.lastTerm`. Each entry has its entry check with DMs for term number
   and characteristics, its skills (a pick list or a tied career's Service Skills), optional `onEntry` effects,
   its events table (2 to 12), its graduation check with an honours total and DMs, its benefits, and an
   optional `tiedCareer`. Without `rules.preCareer` no education is offered. When a pack is loaded, the packs'
   education entries replace the bundled samples, as careers do.
6. **One graduation per character** (Buddy, 2026-11-04). A failed entry or a failed graduation can try again in
   a later term, up to `lastTerm`. After a failed entry the career pick for the same term offers no education.
   An academy's "graduation rolled 2 or less" reads the dice before DMs.
7. **A pre-career commission** that succeeds starts the career at officer rank 1, and that career's first-term
   commission roll is skipped. It is rolled in term 1 of the next career, after basic training, when that
   career is listed and has a commission check; with honours and `honoursAutomatic` it passes with no roll.
8. **The education is a step in the career order.** An education attempt takes the next key prefix, as a
   career does (`education.entry`, `education.skills.pick-<n>`, `education.event`, `education.graduation`, and
   under `career-<n>.` after the first), and it is not a career: careers are still numbered from 1, and the
   first career after education gets full basic training. Its choice is stored as "education:<id>" under
   `start.career`.
9. **Bonuses go to the next career only.** The qualification DM, the commission roll and the academy's entry
   apply to the career started straight after the education term; any other career start clears them. An
   academy graduate who enters the tied career picks its Service Skills to raise to 1 in term 1, after basic
   training. A failed academy graduation whose dice are above `failedEntryUnlessAtOrBelow` keeps the entry
   with no roll, but with no Service Skills and no commission. Graduation that an event skipped gives no
   bonuses.
10. **An education term has no after-term choice.** It ends with aging (from `rules.aging.fromTerm`, as a
    career term) and no benefit rolls. Remove last term on the term after it removes that term's start choices,
    so the career pick after the education term is pending again.

## Engine and data changes

- `src/engine/effects.ts`: the `check`, `fail-graduation` and `next-career` effects. `BasicEffectSchema` is
  every effect but `check` and `choice`.
- `src/engine/terms.ts`: the effects, and a career start that uses the career a `next-career` effect set.
  `CareerRun.forced` is true for that career.
- `src/engine/policy.ts`: Finish career stops when a forced career has started.
- `src/engine/education-schema.ts`: `EducationSchema` and `parseEducation`.
- `src/engine/career-pack.ts`: the pack's `education` array and `combineEducation`. `src/engine/rules-schema.ts`:
  `rules.preCareer`.
- `src/engine/terms.ts`: the education term, `CareerResult.educations`, education options on the career pick,
  and the bonuses at the next career start. `src/engine/policy.ts` needs no change: Finish career stops at the
  career pick.
- `src/data/education/`: the invented sample schools. `src/data/rules/sample-rules.json`: `preCareer.lastTerm`
  3.
- `src/Career.tsx`: the career pick's Education group and the education block.

## Acceptance criteria

- [x] **ED-1** In terms 1 to `rules.preCareer.lastTerm` the career pick lists each education entry; after that
      term it lists none.
- [x] **ED-2** Entry uses the entry check with the DM for the term number and the characteristic DMs, and the
      step lists each DM's reason.
- [x] **ED-3** A failed entry returns to the career pick with education removed for that term, and the term is
      not counted.
- [x] **ED-4** A `pick` education asks for one skill per listed level and gives each at that level; a
      `service-skills` education gives every Service Skill of the tied career at level 0.
- [x] **ED-5** Each education term rolls once on its events table and applies the entry's effects.
- [x] **ED-6** A `fail-graduation` or `next-career` effect in an education term skips the graduation roll and
      the term ends with no benefits.
- [x] **ED-7** A graduation total at or above `honoursAt` gives the honours benefits; a pass below it gives the
      normal benefits; a fail gives none and keeps the skills.
- [x] **ED-8** The qualification DM from graduation applies only to the listed careers and only to the first
      career after education.
- [x] **ED-9** A pre-career commission roll is offered before the first term of a listed career; success starts
      the career at officer rank 1; with an honours rule of `automatic` it passes with no roll.
- [x] **ED-10** An academy graduate's first career start offers the tied career with no qualification roll, and
      three Service Skills to raise to 1 when it is picked.
- [x] **ED-11** A failed academy graduation whose dice are above `failedEntryUnlessAtOrBelow` still offers the
      tied career with no roll and no commission roll in its first term.
- [x] **ED-12** A `next-career` effect naming the Draft in an education term rolls the Draft even when the
      character was drafted before.
- [x] **ED-13** Remove last term on an education term returns the character to the start of that term, and its
      pending bonuses are gone.
- [x] **ED-14** Finish career never picks an education entry, and plays an education term the player picked
      through to the next career start.
- [x] **ED-15** An education term adds `termLength` to the age and counts toward the aging start term.
- [x] **ED-16** A `check` effect adds a "Check" step after the step that gave it, with a characteristic
      option's DM, and applies `pass` on a pass and `fail` on a fail. (Unit test.)
- [x] **ED-17** A `check` with several options asks the player for one; a skill option uses the skill level as
      the DM, and -3 when the character doesn't have the skill. (Unit test.)
- [x] **ED-18** A `check` whose `pass` or `fail` holds a `check` or a `choice`, or whose options repeat, fails
      `EffectSchema`. (Unit test.)
- [x] **ED-19** A `fail-graduation` effect in a career term adds a note and changes nothing else. (Unit test.)
- [x] **ED-20** A `next-career` effect naming a loaded career ends the career after the term; after mustering
      out, that career starts with a qualification step that is not rolled, and the career notice says an
      event sent the character there.
- [x] **ED-21** A `next-career` effect naming the Draft rolls the Draft for the next career, even when the
      character was drafted before. (Unit test.)
- [x] **ED-22** A `next-career` effect naming a career no loaded pack has, or the Draft with no Draft table,
      adds a note and the career does not end. (Unit test.)
- [x] **ED-23** Finish career stops once a `next-career` effect has started the next career, with no choice
      made in it. (Unit test.)
- [x] **ED-24** Remove last term on the first term of a forced career returns to the after-term choice of the
      term before it. (Unit test.)
- [x] **ED-25** When a forced Draft names a career no loaded pack has, the problems list says so and the next
      career is picked as usual. (Unit test.)
- [x] **ED-26** A pick saved under a check's pass effects is not used by its fail effects when the check is
      overridden to a fail. (Unit test.)
- [x] **ED-27** A `next-career` effect naming the current career adds a note and the career does not end.
      (Unit test.)
- [x] **ED-28** A `check` option that is a characteristic name not in capitals, such as `Int`, fails
      `EffectSchema`. (Unit test.)
