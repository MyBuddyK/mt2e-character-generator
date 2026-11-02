# Traveller (MT2e) Character Generator

A web app for players to roll Mongoose Traveller 2nd Edition characters together. The planned scope is
stepping through careers term by term and exporting to Foundry VTT (the JDR-Ninja `mgt2` system). It is
also the owner's portfolio project.

## Commands

- `npm run dev`: local dev server
- `npm run check`: lint (oxlint), typecheck (tsc) and unit tests (Vitest). Run before every commit.
- `npm run test:e2e`: Playwright against a production build. In a sandbox with a preinstalled browser,
  set `PW_CHROMIUM_PATH` to its `chrome` binary.

## Layout

- `src/engine/`: rules logic as plain TypeScript, with no React imports. All randomness goes through
  `dice.ts` so a seed reproduces a character. Every generated value is an `Overridable<T>`.
- `src/data/careers/*.json`: career data, checked by `validateCareer` in `src/engine/career-schema.ts`.
  Every JSON file in that folder is loaded automatically.
- `src/App.tsx`: UI.
- `e2e/`: Playwright specs. `e2e/seed.spec.ts` is the starting page for the Playwright agents.
- `specs/`: test plans from the planner agent. `docs/features/`: feature specs from `feature-designer`.

## Agents (`.claude/agents`)

- `feature-designer`: turns an idea into a feature spec with acceptance criteria.
- `playwright-test-planner` → `playwright-test-generator` → `playwright-test-healer`: Playwright's own
  test agents (plan, write, fix), using the MCP server in `.mcp.json`.
- `playwright-test-monitor`: runs the suite, sorts failures into regressions, broken tests and flaky
  tests, and hands broken tests to the healer.

## Type checking

`tsconfig.app.json` and `tsconfig.node.json` set `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns` and
`noPropertyAccessFromIndexSignature`. Don't loosen these, and don't use `any`, `@ts-ignore` or
`@ts-expect-error` to get past them.

## Documentation rules

These apply to code comments, test names, commit messages, PR descriptions, READMEs, feature specs and test
plans.

- Make no falsifiable statements. Describe only what the code does now. Don't claim performance, quality,
  coverage or behavior that the code or a test doesn't show. Mark planned work as planned.
- Every exported function, type and constant gets a comment that states what it does: its inputs, what it
  returns, and any side effects or edge cases.
- Every test (`it`, `test`) and `describe` block gets a comment or name that states what it checks: the
  setup, the action and the expected result.
- No self-congratulatory or evaluative language: no "robust", "elegant", "clean", "powerful",
  "comprehensive", "best practice", or similar.

## Other rules

- Treat the repo as public. Never commit rulebook text or full tables. Career files hold short summaries and a
  `source` citation; the owner fills in the real data.
- Specs load the app with a fixed `?seed=` so results are deterministic.
- Never skip or delete a test to get green.
