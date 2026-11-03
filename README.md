# Traveller (MT2e) Character Generator

An unofficial fan-made web app for building Mongoose Traveller 2nd Edition characters as a group.

Current state: the app rolls the six characteristics from a seed, and the player can override each value.
Players can import career packs from a file or an https link; the app checks them and lists their careers,
but does not yet run careers.

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

## Career packs

The public site includes only an invented sample career. A referee writes the real careers from their own books
into a career pack, a JSON file described in `docs/features/career-import.md`, and shares it privately with
their players. Each player opens **Career data** on the site and picks **Import from file**, or pastes an
`https://` link and picks **Load from URL**. Packs are saved only in that player's browser. Once a pack is
loaded, the sample career is hidden.

For the referee:

- Keep packs in `careers-private/`. It is listed in `.gitignore`, so `git add .` skips it; `git add -f` does
  not, so take care not to force-add it in a public repo.
- `npm run validate-pack careers-private/my-pack.json` prints the same messages the app shows on import, and
  exits with code 1 if the pack is rejected or any career in it was skipped.
- `npm run schema` writes `public/career-pack.schema.json` (the site also serves it as
  `career-pack.schema.json`). Point a pack's `"$schema"` field at that file, or map it in your editor's JSON
  settings, to get field names and types while editing. It does not check that each roll in a table is covered once or that
  ids are unique; `validate-pack` does.
- A link loads only if the file host allows other sites to read the file (CORS). Which hosts allow this has
  not been tested yet. If a link is blocked, download the file and import it instead.
- A shared link to a character includes `?packs=<id>@<fingerprint>` for the loaded packs. A player whose
  packs differ sees a notice that results may not match.

## Adding bundled career data

`src/data/careers/` holds the sample career that ships with the site. Each JSON file there is checked against
`CareerSchema` in `src/engine/career-schema.ts`. `npm test` fails and lists each problem by file and field,
and the app shows the same list above the characteristics. Since the repo is public, don't put rulebook
text here; use a career pack instead.

## Tech

TypeScript, React, Vite, Vitest, Playwright, GitHub Actions and GitHub Pages. Claude Code agents for feature
design and Playwright testing live in `.claude/agents` (see `CLAUDE.md`).

## License

Code is released under the PolyForm Noncommercial License 1.0.0 (see `LICENSE.md`). You may use, change and
share it for any noncommercial purpose; commercial use is not permitted. This matches the non-commercial
terms of Mongoose Publishing's Fair Use Policy, which covers the game material this tool works with.

## Legal

This is an unofficial fan project, not affiliated with or endorsed by Mongoose Publishing. It follows
Mongoose Publishing's Fair Use Policy (FAQ dated May 1, 2025), which requires this site-wide disclaimer:

> The Traveller, 2300AD, Twilight: 2000 and Dark Conspiracy games in all forms are owned by Mongoose Publishing. Copyright 1977 - 2025 Mongoose Publishing. Traveller is a registered trademark of Mongoose Publishing. Mongoose Publishing permits web sites and fanzines for this game, provided it contains this notice, that Mongoose Publishing is notified, and subject to a withdrawal of permission on 90 days notice. The contents of this site are for personal, non-commercial use only. Any use of Mongoose Publishing’s copyrighted material or trademarks anywhere on this web site and its files should not be viewed as a challenge to those copyrights or trademarks. In addition, any program/articles/file on this site cannot be republished or distributed without the consent of the author who contributed it.

The same text appears in the footer of every page of the app. The license in `LICENSE.md` is the author's
consent to share the code for noncommercial purposes.
