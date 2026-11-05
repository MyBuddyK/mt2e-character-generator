# Review of PR #1 (foundation)

Reviewed on 2026-11-03 by a reviewer that had none of the earlier context. It read the whole branch, ran the checks and wrote probe scripts. I re-checked the top findings myself.

Baseline: lint, typecheck, 15 unit tests and 10 Playwright tests pass. The base-path build rewrites asset URLs as expected.

## Blocker

1. **An override can't be cleared and retyped.** `src/App.tsx:76-78` and `src/engine/overridable.ts:29-30`.
   - Clearing the input gives NaN, which removes the override, so the field snaps back to the rolled value.
   - Backspacing "7" leaves "7", and typing "12" then gives "712".
   - The e2e test uses `fill()`, which hides this.
   - Fix: keep a draft value per field, commit it on blur or when it is valid, add a "reset to rolled" control, and add an e2e test that types keystroke by keystroke.

## Should fix

2. **Overrides aren't clamped or checked for whole numbers, and `toHex` isn't Traveller's extended hex.** `characteristics.ts:31-34`.
   - 18 becomes "I", but extended hex skips I and O, so it should be "J".
   - 99 becomes an invisible control character.
   - 7.5 makes the UPP 8 characters long.
   - Fix: round and clamp values, use a `0-9A-HJ-NP-Z` table, and add unit tests for these values.
3. **The generated healer agent tells the model to mark tests `test.fixme()` and to "do the most reasonable thing possible to pass the test".** `.claude/agents/playwright-test-healer.md:42-45`.
   - This contradicts CLAUDE.md, and it invites changing a test's expected values to match a regression.
   - Fix: remove that instruction, and have the agent stop and report a suspected app bug instead.
4. **`validateCareer` misses a lot, and one input makes it crash.**
   - These all pass validation:
     - event and mishap roll numbers aren't checked
     - mustering-out row shape isn't checked
     - ranks aren't checked
     - duplicate ids are accepted
     - `source` and `summary` can be missing
     - ids that aren't strings are accepted
     - empty skill names are accepted
   - `assignments: [null]` throws an error instead of returning a message.
   - Nothing checks that career ids are unique across files.
5. **Career JSON is only cast to the right type, never checked at runtime.** `src/data/careers/index.ts`.
   - A file with no `name` crashes the sort when the module loads.
   - The whole unit-test file then fails with 0 tests, and the app would show a blank page.
   - That makes the README's "`npm test` tells you what's missing" false in that case.
   - Fix: validate in `index.ts` and throw one error that names the bad file.
6. **The deploy doesn't wait for CI.** A push to main that fails the tests still deploys. Fix: deploy on a successful CI run, or run `npm run check` inside the deploy job.
7. **E2E never tests the base path that Pages serves.** Fix: add a CI job that builds with `BASE_PATH`, and derive Playwright's `baseURL` from it.
8. **The first random seed isn't written to the URL.** A shared link gives a different character, and an empty `?seed=` shows "seed ".
9. **The layout scrolls sideways at 320px wide.** The page is 355px wide on a 320px screen. The mobile test uses 412px, so it can't catch this.
10. **Accessibility.**
    - The dark-mode button text has a contrast ratio of about 2.8:1 (WCAG AA needs 4.5:1).
    - The overridden state is shown only by colour.
    - The UPP has no `aria-live`.
11. **Evaluative wording is still in the generated Playwright agents.**
    - My commit message said it was removed, but only the opening paragraphs changed.
    - Evaluative words are still there: "thoroughly" and three phrases on the banned phrase list.
    - The generator's examples use `tests/` instead of `e2e/`.
12. **Some unit tests would pass even if the code were broken.**
    - The seed test would pass if seeds were ignored.
    - The range test would pass if d6 always returned 1.
    - One override assertion is always true.
    - The "broken career" test doesn't check which messages come back.

## Nits

13. **Inaccurate statements.**
    - CLAUDE.md says "all randomness goes through dice.ts", but `randomSeed` uses `Math.random`.
    - The "8-character" seed comment is occasionally wrong.
    - "Every generated value is an Overridable" is true only for characteristics so far.
    - The DM test says it covers band edges but skips 1, 3, 11 and 14.
14. **The e2e reroll test doesn't check that the displayed seed matches the URL.**
15. **Type casts:** `{} as Characteristics`, `as Partial<CareerDefinition>`, and the non-null `!` on `#root`.
16. **Repo hygiene.**
    - The favicon is still the Vite logo.
    - `.gitignore` has no entry for `.claude/settings.local.json`.
    - There's no LICENSE file.
17. **CI details.**
    - There's no `permissions:` block or concurrency group in `ci.yml`.
    - Playwright browsers aren't cached.
    - `@types/node` is version 24, but CI runs Node 22.
18. **Legal notice.** The README notice is accurate. Consider a footer notice in the app, and check Mongoose's Fair Use Policy for any required wording.
19. **Leftover tool names.** Playwright's generated agents list the `LS` and `MultiEdit` tools, which may no longer exist in Claude Code. This is harmless.

## Checked and fine

- **Agents:** every Playwright MCP tool the agents name exists, and `.mcp.json` matches Playwright's generated config.
- **Rules:** the DM table matches MT2e.
- **Dice:** mulberry32 and FNV-1a are implemented correctly, and the d6 distribution is uniform over 600k rolls.
- **Overrides:** `withOverride` and `isOverridden` behave as their comments say.
- **Separation:** the engine has no React imports.
- **Pages:** the workflow permissions and actions are correct.
- **Dependencies:** all are used and come from the npm registry.
- **Typing:** the strict flags match CLAUDE.md, and there are no `any` or `@ts-ignore`.
- **Content:** there's no rulebook text.
