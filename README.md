# Traveller (MT2e) Character Generator

An unofficial fan-made web app for building Mongoose Traveller 2nd Edition characters as a group.

Current state: the app rolls the six characteristics from a seed, and the player can override each value.
It loads and checks career data files but does not yet run careers.

Planned: stepping through careers one term at a time, showing events that could connect characters,
generating a whole character in one step, and exporting to Foundry VTT.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # lint, typecheck, unit tests
npm run test:e2e   # Playwright (run `npx playwright install chromium` once first)
```

Add `?seed=anything` to the URL to get the same character every time.

## Adding career data

Put a JSON file in `src/data/careers/` following `sample-courier.json`. Each file is checked against
`CareerSchema` in `src/engine/career-schema.ts`. `npm test` fails and lists each problem by file and field,
and the app shows the same list above the characteristics. Use short summaries in your own words and cite the book and
page in `source`; don't copy rulebook text into this repo.

## Tech

TypeScript, React, Vite, Vitest, Playwright, GitHub Actions and GitHub Pages. Claude Code agents for feature
design and Playwright testing live in `.claude/agents` (see `CLAUDE.md`).

## License

Code is released under the PolyForm Noncommercial License 1.0.0 (see `LICENSE.md`). You may use, change and
share it for any noncommercial purpose; commercial use is not permitted. This matches the non-commercial
terms of Mongoose Publishing's Fair Use Policy, which covers the game material this tool works with.

## Legal

Traveller is a trademark of Far Future Enterprises, and the 2nd Edition rules are published by Mongoose
Publishing. This is an unofficial fan project and is not affiliated with or endorsed by either.
