# QA strategy

This repo is built mostly by Claude Code agents: 66 of the first 87 commits on `main` are authored by
Claude, and the owner writes the feature decisions, checks rules against the books and merges each pull
request. This page says which risks the checks in the repo target, what the agents do and what the owner
does, and where the record of each check is kept. It describes the setup as of 2026-11-05.

## Risks and the checks that target them

| Risk | Checks | Where | Gate |
| --- | --- | --- | --- |
| A rule works differently from what the feature spec says | Unit tests and browser tests named by acceptance criteria ids; a script fails when a ticked criterion has no test | `src/**/*.test.ts`, `e2e/`, `scripts/check-conventions.ts`, [`criteria-coverage.md`](criteria-coverage.md) | Every PR |
| A rule works differently from the book | The owner checks careers against their own books by hand, with the private pack loaded | Not recorded in the repo (see Known gaps) | None |
| A change to the engine that no test notices | Stryker mutation testing of `src/engine` | `stryker.config.json`, `.github/workflows/mutation.yml`, [`qa-log/`](qa-log/) | None; monthly and by hand |
| The same seed gives a different character on a later run | Seeded dice through `diceFor(seed, path)`; seed sweeps on 200 fixed seeds check repeatability | `src/engine/dice.ts`, `src/engine/invariants.test.ts` | Every PR |
| A rule that should hold for every seed fails for some seeds | Seed sweeps: characteristic ranges, how Finish career ends, a species changes no dice total | `src/engine/invariants.test.ts` | Every PR |
| A bad career pack crashes the app or loads half-read data | zod schemas, `validate-pack`, unit tests on invented broken packs | `src/engine/career-schema.ts`, `scripts/validate-pack.ts`, `e2e/fixtures/` | Every PR |
| A user flow breaks in the browser | Playwright on a production build, desktop and Pixel 7, at `/` and at the Pages path | `e2e/*.spec.ts`, `.github/workflows/ci.yml` | Every PR |
| A page fails WCAG A or AA rules that axe can detect | axe-core, one test per page state | `e2e/accessibility.spec.ts` | Every PR |
| A test passes only some of the time | Weekly run of every browser test three times with no retries | `.github/workflows/flaky.yml` | None; weekly and by hand |
| An agent weakens a test to get a green run | Lint fails on skipped, focused or empty tests and duplicate titles; agent files forbid skipping tests or weakening assertions | `.oxlintrc.json`, `.claude/agents/` | Every PR (lint) |
| Types are bypassed to get past the compiler | `strict` plus five extra flags; lint fails on `any`, `as` casts, `!` and `@ts-ignore` | `tsconfig.*.json`, `.oxlintrc.json` | Every PR |
| Docs or comments claim what the code doesn't do | Documentation rules in `CLAUDE.md`; a script finds missing comments and listed evaluative phrases | `scripts/check-conventions.ts` | Every PR (the script); review (accuracy) |

"Every PR" means the check runs in `.github/workflows/ci.yml` on each pull request and a failure shows on
the pull request. The deploy to GitHub Pages runs only after CI passes on `main`.

## Who does what

| Step | Agent | Owner |
| --- | --- | --- |
| Feature spec | `feature-designer` drafts the spec and its acceptance criteria in `docs/features/` | Decides open questions and edits the spec before work starts |
| Build | Claude writes the code and the tests, and names criteria in `// Criteria:` comments | Reads the pull request |
| Test plan | `playwright-test-planner` writes plans to `specs/`; `playwright-test-generator` turns them into specs | Nothing required |
| Review | A review pass reads the branch and lists findings; fixes go in their own commit | Reads the findings |
| Rules check | None | Checks the rules against the books with the private pack |
| Merge | None | Merges the pull request |
| Failing or flaky tests | `playwright-test-monitor` sorts failures into regressions, broken tests and flaky tests; `playwright-test-healer` fixes broken tests | Decides on any `test.fixme` or removed test |

An agent may not skip a test, delete one to get a green run, or change an expected value to match a
regression. A failure the monitor classifies as a regression is reported, not fixed by changing the test.

## The loop

1. The owner states a feature. `feature-designer` writes the spec with criteria ids such as `CT-4`.
2. The owner answers its open questions. Criteria are ticked (`[x]`) once they are built.
3. Claude builds the feature, with tests whose comments end in `// Criteria: ...`.
4. `npm run check` runs lint, typecheck, the conventions check, the criteria coverage check and the unit
   tests. CI runs the same and the browser suite.
5. A review pass lists findings, and a follow-up commit fixes them. [`qa-log/reviews.md`](qa-log/reviews.md)
   lists those commits.
6. The owner merges. Pages deploys after CI passes on `main`.
7. Each week the flakiness check runs, and each month mutation testing runs. The monitor reads the
   results, and its report goes in [`qa-log/`](qa-log/).

## Records

- [`criteria-coverage.md`](criteria-coverage.md): each acceptance criterion and the tests that name it.
  Generated by `npm run criteria`; `npm run check` fails when it is out of date.
- [`qa-log/`](qa-log/): dated reports of test runs, mutation scores and flakiness runs, and the list of
  review rounds.
- The README's "How this is tested" section: the test layers and a table of mutation scores, newest first.

## Known gaps

These are known and not yet addressed. Each is a candidate for later work, not a claim about the current
checks.

- No test records the full character a given seed produces, so a change to roll path keys in
  `src/engine/terms.ts` could change what an old shared `?seed=` link shows without a failing test.
- The seed sweeps use a fixed list of seeds and two fixture careers. There are no generated inputs (random
  packs or override sets) and no shrinking to a smallest failing case.
- Coverage and mutation scores fail on no threshold. CI retries a failed browser test twice.
- Stryker leaves out the seed sweeps and runs with its TypeScript checker off (`tsconfigFile` names a
  missing file, because Stryker's tsconfig rewrite calls an API TypeScript 7 lacks). Mutants that only the
  sweeps or the type checker would catch count as survived.
- Checks of the rules against the books are made by hand and are not recorded in the repo. The repo holds
  only invented data, so CI never runs a real career pack.
- The conventions check can't tell whether a comment or a count in a doc is accurate; that is left to review.
