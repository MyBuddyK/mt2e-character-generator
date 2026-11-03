# Career rules enforcement (step 2, part 2)

Status: part 2a (rule enforcement in one career) is built. Part 2b (more than one career) and aging are built.

## Problem

Part 1 plays one career term by term, but several rules from the book are left for the players to apply
by hand: a natural 2 on survival, leaving or staying because of the advancement roll, losing the benefit
roll after a mishap, and the skill limits. The owner wants the app to apply these rules, so a character
made with a full career pack follows the book without the players checking each step.

## Scope and order

1. **Part 2a: rule enforcement in one career.** The rules below are applied in the career that part 1
   plays. Each one is switched on by a value in the pack's `rules` object or career data, so packs without
   the value behave as they do now.
2. **Part 2b: more than one career.** Leaving a career and qualifying for another, DM-1 for each previous
   career, the Draft (once per character) and the Drifter fallback when qualification fails, not
   re-entering the career just left, commissions and officer ranks for the careers that have them, and
   changing assignments. Part 2b gets its own section in this file before it is built.

## Decisions

1. **Rules are data.** Each rule has a field in `rules` (values that apply to every career) or in the
   career (values that apply to one career). A pack that leaves a field out doesn't get that rule. The
   bundled sample rules leave the new fields out; the e2e fixture `rules-enforced-pack.json` sets them.
   The one change for packs without the new fields is that the rank benefit DM now applies to cash rolls
   too, as the book says.
2. **The rule sets the default, and an override still wins.** Every value a rule decides is shown with the
   reason. An outcome override replaces a pass or fail (so it beats a natural 2 on survival). The forced
   leave and forced stay rules read the advancement dice and total, so the player changes them by
   overriding the advancement dice (product principle 3).
3. **Natural rolls use the dice, not the total.** "Natural 2" and "natural 12" compare the dice before
   DMs. A dice override counts as the natural roll.

## Rules in part 2a

| Rule | Where it lives | What the app does |
| --- | --- | --- |
| Survival natural fail | `rules.survival.failOnNatural` (e.g. 2) | Dice at or below this value fail survival, whatever the DMs. The step says "Natural 2: fails". |
| Mishap costs the term's benefit | `rules.benefits.mishapLosesTerm` (true or false) | A term that ends in a mishap from failed survival gives no benefit roll. Earlier terms still count. |
| Advancement forces leaving | `rules.advancement.leaveAtOrBelowTerms` (true or false) | An advancement total at or below the terms served in the career ends the career after this term. The Next step offers only Muster out and says why. |
| Advancement forces staying | `rules.advancement.stayOnNatural` (e.g. 12) | Dice at or above this value mean the character must continue. The Next step offers only Continue in career and says why. |
| Skill level limit | `rules.skillLimits.maxLevel` (e.g. 4) | A gain that would take a skill above this level is lost, and the step says so. |
| Total skill limit | `rules.skillLimits.totalPerIntEdu` (e.g. 3) | A gain that would take the sum of all skill levels above this value × (INT + EDU) is lost, and the step says so. |
| Rank DM on all benefit rolls | `rules.benefits.rankBenefitDM` (existing field) | The DM now applies to cash rolls too, as the book says for ranks 5-6. |
| Cash DM from a skill | `rules.benefits.cashSkillDM` (e.g. `{ "skill": "Gambler", "dm": 1 }`) | A character with the skill at any level gets the DM on cash rolls. |
| Automatic qualification | career `qualification.automatic` (true), or `qualification.automaticAt` (a characteristic value) | The qualification roll is skipped and passes. With `automaticAt`, it passes when the checked characteristic is at least that value, and is rolled otherwise. |
| Qualification on the better of two | career `qualification.characteristic` as a list (e.g. `["DEX", "INT"]`) | The roll uses the higher DM of the listed characteristics. Survival and advancement checks accept a list too. |
| Qualification age DM | career `qualification.ageDM` (e.g. `{ "fromAge": 30, "dm": -2 }`) | Applied when the character's age is at least `fromAge` at the start of the term. |
| Basic training from the assignment | career `basicTraining: "assignment"` | Basic training uses the assignment's skill table instead of `rules.basicTraining.table`. |
| "X or Y" table entries | skill table entries such as `"Drive or Vacc Suit"` | The player picks one, as with a `skill` effect that has several options. |
| Automatic promotion | new effect `{ "type": "promote" }` | The advancement roll is skipped and passes. |
| Mishap that doesn't end the career | new effect `{ "type": "stay-in-career" }` on a mishap | The career continues after the mishap. |
| Mishap that keeps the benefit roll | new effect `{ "type": "keep-benefit" }` on a mishap | The term still gives its benefit roll. |
| Ageing crisis | none (always on) | When a term's aging effects take a characteristic from above 0 to 0 or below, the aging step shows an ageing crisis reason for the players to resolve by hand. Aging rows without `effects` are notes, so they never cause one. |

Choices inside events and mishaps ("accept or refuse", "roll Melee 8+: on a success …") stay as notes in
part 2a.

## Finish career

Requested by the owner on 2026-11-03, replacing Generate the rest and a short-lived "More terms" field.

- The button is named Finish career. It makes the remaining choices with the policy in
  `src/engine/policy.ts`: it continues term after term until the character is forced out (a mishap, a
  `leave-career` effect or the advancement rule), then musters out. The rules' `termLimit` caps the
  terms, for packs whose rules never force the character out.
- When a term's aging causes an ageing crisis, it stops at that term's after-term choice and a notice
  says why, so the players can resolve it before going on.
- It is also offered when the career is forced to end, where it rolls the benefits.
- Where an event, mishap, rank or table entry offers a choice of skills, or a wager asks how many
  benefit rolls to bet, Finish career picks at random with `Dice.pick` from the dice for
  `finish:<choice key>`, so the same seed gives the same picks. It still uses the last skill table
  offered, and takes cash for the first benefit roll.

## Wagers

Requested by the owner on 2026-11-03, for events where the character bets benefit rolls on a skill roll.

- Effect `{ "type": "wager", "skills": [...], "target": 8, "maxWager": 1, "gainUsedSkill": true }`
  (`maxWager` and `gainUsedSkill` are optional).
- The player picks how many benefit rolls to wager, from 0 to the rolls earned in the career so far
  (terms served times `benefits.perTerm`, plus extra rolls from effects, minus terms lost to mishaps;
  rank extras are not counted), capped by `maxWager`. Wagering 0 skips the roll.
- With more than one skill, the player picks the skill. The roll is 2D plus the skill level (DM -3 when
  the character doesn't have the skill) against `target`, with the usual dice and result overrides.
- Success adds half the wager, rounded up, as extra benefit rolls; failure removes the wager. The
  benefit count never goes below 0. With `gainUsedSkill`, the skill used gains a level either way.

## User flow

1. The player steps through a term as in part 1.
2. When a rule decides a result, the step shows the result and a one-line reason, for example "Natural 2:
   survival fails" or "Advancement 3 is at or below 3 terms: you must leave after this term".
3. The player can override the dice or the outcome. A dice override reruns the rules, so the result,
   reason and forced choice update.
4. At mustering out, the benefit count leaves out a term lost to a mishap, and each roll shows the DMs it
   uses (rank, event, Gambler).

## UI

- A rule reason is a short line under the step (`data-testid="step-reason"`), in the same style as the
  "Applied:" line. Benefit rolls list the DMs they use (rank, event, cash skill) the same way.
- A lost skill gain shows "Lost: Gun Combat 5 is above the skill limit of 4." in the step.
- The Next step with a forced choice shows only the allowed button and the reason, as part 1 does after a
  mishap.

## Engine and data changes

- `src/engine/rules-schema.ts`: optional `survival`, `advancement` and `skillLimits` objects, and optional
  `benefits.mishapLosesTerm` and `benefits.cashSkillDM`.
- `src/engine/career-schema.ts`: `CheckSchema.characteristic` accepts one characteristic or a list;
  qualification gets optional `automatic`, `automaticAt` and `ageDM`; careers get optional `basicTraining`.
- `src/engine/effects.ts`: `promote`, `stay-in-career` and `keep-benefit`.
- `src/engine/terms.ts`: applies each rule in the table and records the reason on the step.
- `src/engine/policy.ts`: Finish career follows a forced muster or a forced continue.
- `e2e/fixtures/rules-enforced-pack.json`: an invented pack whose rules set the new fields.
- README "Writing a career pack": lists the new fields.

## Acceptance criteria (part 2a)

Unit tests in `src/engine/terms.test.ts` ("buildCareer rule enforcement") check each criterion; the e2e
specs in `e2e/career.spec.ts` ("career rule enforcement") check the natural 2 and natural 12 cases in the
browser.

- [x] With `rules.survival.failOnNatural` set, survival dice of 2 fail even when the DM would make the total
      pass, and the step shows the reason.
- [x] With `rules.benefits.mishapLosesTerm` true, leaving after a term-2 mishap gives benefit rolls for
      term 1 only (plus rank extras).
- [x] With `rules.advancement.leaveAtOrBelowTerms` true, an advancement total at or below the terms served
      offers only Muster out, with the reason.
- [x] With `rules.advancement.stayOnNatural` set to 12, advancement dice of 12 offer only Continue in career,
      with the reason.
- [x] Overriding the outcome of a survival roll that a natural 2 failed makes it pass.
- [x] A skill gain above `rules.skillLimits.maxLevel` is lost and the step says so.
- [x] A skill gain that would take the total above `totalPerIntEdu` × (INT + EDU) is lost and the step says
      so.
- [x] The rank benefit DM applies to cash rolls and benefit-table rolls.
- [x] With `cashSkillDM` set to Gambler, a character with Gambler gets the DM on cash rolls only.
- [x] A career with `qualification.automatic` starts without a qualification roll.
- [x] A qualification check with two characteristics uses the higher DM.
- [x] A career with `basicTraining: "assignment"` trains in the assignment's skills.
- [x] A skill table entry "A or B" asks the player to pick A or B.
- [x] An event with `promote` passes the advancement roll without rolling.
- [x] A mishap with `stay-in-career` lets the career continue; one with `keep-benefit` keeps the term's
      benefit roll.
- [x] Aging that takes a characteristic to 0 shows an ageing crisis reason.
- [x] A pack without the new fields builds the same career as before for the same seed and input, apart
      from the rank DM on cash rolls (the part 1 tests pass unchanged).
- [x] Finish career follows the forced choices.

## Part 2b: more than one career

### Decisions

1. **Careers follow one another in one character.** After mustering out, the player picks the next career
   or Done. The career just left is not offered (the book's rule), except through the Draft.
2. **Qualification failure offers the Draft or the fallback career.** The Draft can be taken once per
   character. The fallback career (`rules.fallbackCareer`, for example a Drifter career) needs no
   qualification roll. Overriding the qualification roll is still possible.
3. **Keys stay stable.** The first career keeps the keys it has now ("start.career", "term-1.survival",
   "benefit-0"), so saved characters still load. Later careers prefix their keys with "career-<n>.", and
   their terms are numbered within the career ("career-2.term-1.survival"). Terms are shown with their
   number across the whole character ("Term 5"), and age and aging count every term served.
4. **Finish career finishes the current career.** It stops when the next career has to be chosen, and at
   a qualification failure, where the player decides.
5. **Some book rules stay notes.** The Prisoner career, changing assignments, and the ageing crisis making
   later qualification rolls fail are not built in part 2b.

### Data

| Field | Where | What the app does |
| --- | --- | --- |
| `rules.qualification.dmPerPreviousCareer` | rules | DM on each qualification roll for every earlier career (the book: -1). Drafted and fallback careers don't roll. |
| `rules.draft` | rules | The Draft table: `[{ "roll": 1, "career": "navy" }, { "roll": 4, "career": "merchant", "assignment": "merchant-marine" }, …]`, rolled on 1D. With no `assignment`, the player picks one. |
| `rules.fallbackCareer` | rules | The career id offered when qualification fails. |
| `rules.commission` | rules | `{ "anyTermFromSOC": 9, "dmPerLaterTerm": -1 }`: commission rolls are allowed in a career's first term, or in any term with SOC at or above `anyTermFromSOC`, with this DM for each term after the first. |
| `commission` | career | The commission check (for example SOC 8+). A career without it has no commissions. |
| `officerRanks` | career | Ranks 1 to 6 for officers, shaped like assignment ranks. |
| `skillTables.officer` | career | The officer skill table, offered only to officers. |

### Rules

- Basic training: the first career gives every skill on the training table at `rules.basicTraining.level`.
  A later career asks the player to pick one skill from it.
- Cash rolls: `rules.benefits.cashRollLimit` counts across all careers.
- Commission: in a term where a commission is allowed and the character isn't an officer, the player
  chooses Try for commission or Skip after the event. Advancement DMs from events apply to it. A success
  makes the character a rank 1 officer, gives the officer rank's bonus and the advancement skill rolls,
  and replaces that term's advancement roll. Officers advance through `officerRanks`. For benefit rolls,
  an officer's rank is their officer rank plus the enlisted rank they had when commissioned.
- A dm-next qualification effect applies to the next career's qualification roll.

### UI

- After mustering out, the summary is followed by an optional Next career picker that leaves out the
  career just left. Each career gets its own block ("Career 2") with its qualification roll, terms and
  mustering out.
- A failed qualification shows Take the Draft (while it is allowed) and Enter <fallback career>. A career
  entered from the Draft without an assignment on its row asks for the assignment.
- In a term that allows a commission, Try for commission and Skip commission come after the event.
  Finish career tries for a commission, and stops at a failed qualification and before the next career.

### Acceptance criteria (part 2b)

- [x] After mustering out the character is finished, and a next career can be started that isn't the
      career just left. Its terms continue the term numbers and the age.
- [x] `dmPerPreviousCareer` applies to each later qualification roll, and the step says why.
- [x] A later career's basic training asks for one skill.
- [x] The cash roll limit counts every career.
- [x] A failed qualification offers the Draft (once per character) and the fallback career. The Draft row
      sets the career, and its assignment when it names one.
- [x] A rules file without `draft` or `fallbackCareer` asks for a career again after a failed
      qualification, as before.
- [x] A commission is offered in a career's first term, and in later terms only with SOC at or above
      `anyTermFromSOC`, with `dmPerLaterTerm` per later term. Passing it gives officer rank 1, the officer
      skill table, and no advancement roll that term.
- [x] An officer's benefit rank is the officer rank plus the enlisted rank at commission.
- [x] Finish career tries for a commission and counts the term limit per career.

## Aging

Buddy asked for the aging rules to be applied, with the player told what to adjust and able to ignore or
override aging or take anagathics. Medical care follows the book only (Buddy's call): it pays for an ageing
crisis, not for points lost to ordinary aging.

| Field | What the app does |
| --- | --- |
| effect `{ "type": "reduce", "characteristics": ["STR", "DEX", "END"], "amounts": [2, 1] }` | Reduces a different characteristic, picked by the player, by each amount. When every amount left is the same and as many characteristics are left, all of them are reduced without asking. |
| `rules.aging.crisis` `{ "costDice": 1, "costPerDie": 10000 }` | When aging takes a characteristic to 0 or below, the player picks Pay for medical care (the cost is rolled and taken from cash, the characteristics go back to 1, and every later qualification roll fails) or The character dies (the character is finished, with no mustering out). Without this field the crisis is noted for the player to resolve by hand, as before. |
| `rules.anagathics` `{ "characteristic": "SOC", "target": 10, "costDice": 1, "costPerDie": 200000, "prisonOnNatural": 2 }` | Each term has an Anagathics checkbox. Starting needs the check; while taken, each term rolls the cost (taken from cash), rolls survival twice (either failure is a mishap), and adds the number of terms taken in a row to the aging roll. A term without them after a term with them rolls aging at once. Dice at or below `prisonOnNatural` on the starting check add a note (the Prisoner career isn't built). |

- Every aging roll has an Ignore this aging result checkbox. Its dice can be overridden like any roll.
- Cash in the summary is mustering-out cash less anagathics and medical costs; below 0 it is shown as a debt.
- Finish career picks characteristics to reduce at random, takes no anagathics, and stops at an ageing
  crisis for the player to decide.

### Acceptance criteria (aging)

- [x] A reduce effect asks for a different characteristic for each amount, and doesn't ask when there is no choice.
- [x] An ignored aging roll changes nothing.
- [x] With `rules.aging.crisis`, a crisis asks for care or death; care restores the characteristics to 1,
      adds the cost, and fails later qualification rolls; death finishes the character.
- [x] A term on anagathics adds its cost, a second survival roll and the aging DM; stopping rolls aging at once.

## Open questions

1. Should the ageing crisis also stop the career (the book says later qualification rolls fail), or only
   show a notice until part 2b? Part 2a shows a notice.
