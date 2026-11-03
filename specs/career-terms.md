# Career terms test plan

- **Feature spec:** [`docs/features/career-terms.md`](../docs/features/career-terms.md)
- **Seed file:** `e2e/seed.spec.ts`
- **Tests:** `e2e/career.spec.ts`, describe block "career terms plan"
- **How it was made:** written by following the steps in `.claude/agents/playwright-test-planner.md` against
  a production build (`vite preview`), with the page read through Playwright accessibility snapshots. The
  Playwright test MCP server in `.mcp.json` was not available in the session that wrote it, so the agent's
  `planner_*` tools were not used.

Every scenario starts from a fresh browser context (empty localStorage) at `./?seed=terms` with only the
bundled sample career loaded, unless it says otherwise. The sample rules give a starting age of 18, a term
length of 4, aging from term 3, one benefit roll per term and a cash roll limit of 2.

## Criteria coverage

Each acceptance criterion in the feature spec, and the test that checks it. "Plan" rows are the scenarios
below.

| # | Criterion (shortened) | Checked by |
| - | --- | --- |
| 1 | Same seed, same first term | e2e: "the same seed gives the same first term" |
| 2 | Failing survival gives a mishap, no advancement | e2e: "a failing survival roll gives a mishap; reset brings back the event" |
| 3 | Resetting the override brings the event back | e2e: same test as 2 |
| 4 | Advancement override does not change the term 2 skill roll | Plan 1.4 |
| 5 | Event `skill` effect adds the skill | e2e: "an event with a skill effect adds the chosen skill" |
| 6 | Rank `skill` effect adds the skill; `bonus` only is a note | Plan 1.2 and 1.3 |
| 7 | First term adds basic training skills | Plan 1.1 |
| 8 | After failed survival, Muster out and no Continue | e2e: same test as 2 |
| 9 | Benefit total above the table uses the highest row | Unit-level: `terms.test.ts` "a benefit total above the table uses the highest row and says so". The sample career's benefit total reaches 8 only at rank 3 with an event DM, which takes several terms of set-up in the browser. |
| 10 | Two packs with different `rules` | e2e: "with two packs that have different rules, the first by id is used" |
| 11 | Saved seed with other packs, Start over | e2e: "saved choices made with other packs ask before applying" |
| 12 | Version 1 pack with `effects` is rejected | e2e: "a version 1 pack that uses effects is rejected" |
| 13 | Event without `effects` is a note | e2e: "an event without effects is shown as a note" |
| 14 | Connection marker | e2e: "a connection event shows the Connection marker" |
| 15 | Connection opportunities list, and its empty line | e2e: "the finished character lists connection opportunities"; empty line: Plan 1.6 |
| 16 | Continue in career adds a term, age goes up | e2e: "continue in career adds a term four years later" |
| 17 | Aging from the threshold, not before | Plan 1.5 |
| 18 | Finish career finishes, choices can change | e2e: "finish career finishes the character and its choices can still be changed" |
| 19 | Leave career gives the benefit rolls in `rules` | e2e: "leaving gives the benefit rolls set in the rules" |
| 20 | Cash or benefit per roll, cash within the limit | Plan 1.7; switching a roll after it is made: unit-level, `terms.test.ts` "stops offering cash once the cash roll limit is reached" |
| 21 | Choices, overrides and notes kept after reload | e2e: "choices, overrides and notes are kept after a reload" |
| 22 | Sample rules notice | e2e: "the sample rules notice is shown with only bundled data" |
| 23 | No sideways scroll at 320px with three terms | e2e: "the Career section fits at 320px with three terms" |
| 24 | Keyboard only | e2e: "the Career section works with the keyboard" |

## 1. Career terms plan

**Seed:** `e2e/seed.spec.ts`

### 1.1 Basic training applies in the first term only

**Criterion:** career-terms.md #7, "The first term adds the skills from the `basicTraining` table at the
level in `rules`."

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. Set **Term 1 Survival dice** to 12, **Term 1 Advancement dice** to 2, and click **Continue in career**,
   then **Service skills**.

**Expected:**
- After step 1, term 1 has a Basic training step that reads "Applied: Vacc Suit 0, Pilot 0, Mechanic 0,
  Electronics 0, Broker 0, Steward 0".
- After step 2, term 2 has no Basic training step.

**Fails if:** the training step is missing, lists other skills or levels, or appears again in term 2.

### 1.2 A rank with a skill effect applies the skill

**Criterion:** career-terms.md #6, first half.

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. Set **Term 1 Survival dice** to 12 and **Term 1 Advancement dice** to 12.

**Expected:** term 1 shows "rank 1 Tug Pilot", and its rank 1 step reads "Applied: Pilot 1".

**Fails if:** the rank step is missing or shows the bonus as a note.

### 1.3 A rank with only a bonus is shown as a note

**Criterion:** career-terms.md #6, second half.

**Fixture:** `e2e/fixtures/valid-pack.json` (format version 1, ranks with `bonus` and no `effects`).

**Steps:**
1. Open `./?seed=terms` and import `valid-pack.json` with **Import from file**.
2. Click **Start career** (the first listed career, Test Courier), then **Service skills**.
3. Set **Term 1 Survival dice** to 12 and **Term 1 Advancement dice** to 12.

**Expected:** the rank 1 step reads "Apply by hand: Pilot 1" and does not read "Applied: Pilot 1".

**Fails if:** the bonus is applied as a skill, or not shown.

### 1.4 Overriding term 1 advancement does not move the term 2 skill roll

**Criterion:** career-terms.md #4.

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. Set **Term 1 Survival dice** to 12 and **Term 1 Advancement dice** to 2. Click **Continue in career**,
   then **Service skills**. Read the **Term 2 Skill roll: Service skills dice** value.
3. In a fresh context, repeat step 1, set **Term 1 Survival dice** to 12 and **Term 1 Advancement dice** to
   12, pick **Service skills** for the advancement skill roll, click **Continue in career**, then
   **Service skills**, and read the same field.

**Expected:** the two values are equal (3 with this seed), and both terms gain the same skill from it.

**Fails if:** changing the advancement roll changes the term 2 skill roll.

### 1.5 Aging is rolled from term 3, not before

**Criterion:** career-terms.md #17.

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. For terms 1, 2 and 3: set Survival dice to 12, Event dice to 9 and Advancement dice to 2; between
   terms click **Continue in career**, then **Service skills**.

**Expected:** terms 1 and 2 have no Aging step; term 3 has an Aging step with a **Term 3 Aging dice**
field.

**Fails if:** aging appears before term 3, or is missing from term 3.

### 1.6 A character with no connection events shows the empty line

**Criterion:** career-terms.md #15, second half ("is empty with a short line when there are none").

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. Set **Term 1 Survival dice** to 12, **Term 1 Event dice** to 8 (an event that is not a connection) and
   **Term 1 Advancement dice** to 2.
3. Click **Leave career**, then **Benefit**.

**Expected:** the finished summary shows "No events in these careers were marked as connection
opportunities." and no connections list.

**Fails if:** the list is shown, or the line is missing.

### 1.7 The cash roll limit disables Cash and the cash total adds up

**Criterion:** career-terms.md #20, "the cash total stays within the limit in `rules`".

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. Play three terms as in 1.5, then click **Leave career**.
3. Click **Cash** twice.
4. Check the Mustering out choice, then click **Benefit**.
5. Set the two **Mustering out Cash roll dice** fields to 1 and 6.

**Expected:**
- After step 3 the prompt reads "Benefit roll 3 of 3", **Cash** is disabled, and the text "The cash roll
  limit has been reached." is shown.
- After step 5 the summary cash is Cr11000 (Cr1000 for roll 1 and Cr10000 for roll 6 on the sample table).

**Fails if:** a third cash roll can be made, or the summary cash is not the sum of the two rows.

### 1.8 Overriding a survival result to Fail gives a mishap

**Criterion:** none in the feature spec; it checks the outcome override that `CLAUDE.md` asks for on every
roll ("Store each value the generator decides as an `Overridable<T>`").

**Steps:**
1. Open `./?seed=terms`, click **Start career**, then **Service skills**.
2. Set **Term 1 Survival dice** to 12, then pick **Fail** in **Term 1 Survival result**.

**Expected:** the survival step shows Overridden, the term has a mishap and no event, and **Muster out**
is offered.

**Fails if:** the passing dice total wins over the Fail override.
