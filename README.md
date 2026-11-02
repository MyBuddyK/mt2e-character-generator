# Traveller (MT2e) Character Generator

An unofficial fan-made web app for building Mongoose Traveller 2nd Edition characters as a group. Players
step through careers one term at a time, see events that could connect their characters, override any
roll, and export the finished character to Foundry VTT.

> Status: foundation only. Characteristics roll, can be overridden, and are reproducible from a seed. The
> career loop and Foundry export come next.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # lint, typecheck, unit tests
npm run test:e2e   # Playwright (run `npx playwright install chromium` once first)
```

Add `?seed=anything` to the URL to get the same character every time.

## Adding career data

Put a JSON file in `src/data/careers/` following `sample-courier.json`. The unit tests validate every career
file, so `npm test` tells you what's missing. Use short summaries in your own words and cite the book and
page in `source`; don't copy rulebook text into this repo.

## Tech

TypeScript, React, Vite, Vitest, Playwright, GitHub Actions and GitHub Pages. Claude Code agents for feature
design and Playwright testing live in `.claude/agents` (see `CLAUDE.md`).

## Legal

Traveller is a trademark of Far Future Enterprises, and the 2nd Edition rules are published by Mongoose
Publishing. This is an unofficial fan project and is not affiliated with or endorsed by either.
