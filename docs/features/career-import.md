# Career file import

Status: built. Not yet done: the list of file hosts that allow loading from other sites (decision 5).

## Problem

The public site can only include the invented sample career. Under item 3 of Mongoose Publishing's Fair Use
Policy (FAQ dated May 1, 2025), the real career tables must stay out of the public repo. The referee builds a career file from their own
books and shares it privately with their players. Each player needs a way to load that file into the public site,
either from their device or from a link, and keep it between visits.

## Decisions

1. **One file, many careers ("career pack").** A pack is a single JSON file that holds any number of careers, so
   the referee shares one file instead of one per career. Players can load more than one pack, for example one
   for the core book and one per supplement.

   ```json
   {
     "format": "mt2e-career-pack",
     "formatVersion": 1,
     "id": "my-group-core",
     "name": "Core careers",
     "revision": 3,
     "source": "Typed up from my own copy of the Core Rulebook",
     "careers": [ { "...": "one CareerSchema object per career" } ]
   }
   ```

   - `format` and `formatVersion` identify the file type and the version of this schema. A file without them,
     or with a later `formatVersion` than the app knows, is rejected with a message that says so.
   - `id` identifies the pack. Importing a pack whose `id` is already loaded replaces the old copy, after the
     player confirms. The confirmation shows both revisions.
   - `revision` is a whole number that the referee raises each time they edit the pack.
   - Each entry in `careers` is checked with the existing `CareerSchema`.

2. **Validation matches the bundled careers.** The app checks a pack with a new zod `CareerPackSchema`, then
   checks each career with `CareerSchema`. Invalid careers are skipped and listed by pack name, career index and
   field, and the valid ones still load. This differs from `loadCareers` for bundled files, which leaves out a
   whole file when any field in it fails.
   - **Duplicate career ids.** A career id used by more than one loaded pack is reported. The career kept is the
     one from the pack whose `id` sorts first, so the result doesn't depend on the order the player imported the
     packs in, and two players with the same `?packs=` set get the same careers.
   - The sample career takes no part in this check while any pack is loaded, because it is hidden then
     (decision 4). A pack career may reuse the sample's id.

3. **Storage stays in the player's browser.** Packs are saved in `localStorage` under one key,
   `mt2e.careerPacks.v1`, as the raw pack JSON plus the time it was imported. The app never uploads a pack to
   any server; URL loading only downloads one. Every read and write is wrapped in try/catch.
   - If storage is unavailable (private browsing, blocked site data), packs stay loaded for that visit only, and
     the app says so.
   - If a write fails after storage has worked, for example with `QuotaExceededError`, the value already saved
     under the key is left as it was, the new pack stays loaded for that visit only, and the app says the pack
     could not be saved and names it. A removal that can't be saved shows an alert saying the pack will come
     back after a reload.
   - Saved values the app can't read, and saved packs that no longer pass the schema (for example after a
     format change), are kept in storage and listed. The player can remove each pack, or delete the
     unreadable values.

4. **The sample career is hidden once a pack is loaded.** With nothing loaded, the site lists the invented
   sample career (`sample-sanitation.json`, an orbital sanitation job), marked "Sample", so it can be used
   without any import. Once at least one pack is loaded, the sample is hidden from the career list. Removing
   every pack shows it again.

5. **Packs can be loaded from a file or from a URL.**
   - **File:** the player picks a JSON file from their device.
   - **URL:** the player pastes an `https://` link. The app fetches it with `fetch(url)` and checks the
     response the same way as a file. Plain `http://` links and other schemes are refused.
   - A pack loaded from a URL is saved with its URL. A **Check for update** button fetches it again and, if
     its fingerprint differs from the saved copy, offers to replace it, showing both revisions and
     fingerprints. If the fingerprint changed but the `revision` did not go up, the offer also says the
     referee may have forgotten to raise it. The pack being checked is the one replaced, even if the pack at
     the URL now has a different `id`; the confirmation then names both ids.
   - A browser can only read a file from another site when that site's server allows it, through the CORS
     `Access-Control-Allow-Origin` header. Some file hosts send that header for raw file links and some
     don't. When the request is blocked, the app says the host doesn't allow loading from other sites, and
     suggests downloading the file and importing it instead. Which hosts work has not been tested yet; the
     README will list them once it has.
   - A link that anyone can open makes the pack readable by anyone who has the link. The import dialog says
     this next to the URL field.
   - The fetched content is only parsed as JSON and checked with the schemas. It is never run as code.

6. **Seeds record which data they used.** A character rolled from a seed depends on the career data as well as
   the seed. The app computes a short fingerprint for each loaded pack: the first 8 hex characters of the
   SHA-256 of the pack's JSON in a fixed key order. The fingerprint is added to the shared URL as
   `?packs=<id>@<fingerprint>,...`. When someone opens a link and their loaded packs differ, the app warns that
   the results may not match the referee's. It still rolls with the packs that are loaded; it never refuses.
   While the packs differ, the address bar keeps the link's `?packs=` value, so a reload still shows the
   notice.

7. **Authoring help for the referee.**
   - A JSON Schema generated from the zod schemas with `z.toJSONSchema`, published with the site as
     `career-pack.schema.json`. Editors that read JSON Schema, such as VS Code, can use it for field names,
     types and required fields. The checks written as `superRefine` (each roll in a table covered once,
     unique assignment ids and rank values) are not in the JSON Schema; only the app and `validate-pack` run
     them.
   - `npm run validate-pack <file>`, which prints the same messages the app would show.
   - A `careers-private/` folder in the repo for the referee's own packs, listed in `.gitignore` so that
     `git add .` and `git status` skip it. `git add -f` still commits files there, so the folder lowers the
     chance of committing a pack by accident but does not prevent it.

## User flow

1. The referee writes a pack from their books in `careers-private/` and checks it with `npm run validate-pack`.
   They then either send the file to their players (Discord, email) or host it and send the link.
2. A player opens the site and goes to the **Career data** section.
3. The player clicks **Import from file** and picks the file, or pastes the link and clicks **Load from URL**.
4. The app checks the pack and shows the result: the pack name, its revision, its fingerprint, how many careers
   loaded, and any problems.
5. The careers appear in the career list, the sample career is hidden, and the pack is saved in the player's
   browser.
6. On later visits, the pack is still loaded. The player can remove it, import a newer revision, or use
   **Check for update** on a pack that came from a URL.

## UI

A **Career data** section above the career list:

```
Career data                                        [Import from file]
  Pack URL [ https://...                                ] [Load from URL]
──────────────────────────────────────────────────────────────────────
Core careers   rev 3  fp 1a2b3c4d  12 careers  file   [Remove]
Supplement 4   rev 1  fp 9f8e7d6c   5 careers  URL    [Check for update] [Remove]
──────────────────────────────────────────────────────────────────────
Packs are stored only in this browser. Nothing is uploaded.
```

States:

- **Nothing imported:** no pack rows. A line explains that the referee can share a career pack, and the career
  list shows the sample career.
- **Import succeeded with problems:** the pack row, plus a list of skipped careers and their messages.
- **Import failed:** an alert naming the file or URL and the reason (not JSON, wrong `format`, later
  `formatVersion`, no valid careers). Nothing is saved.
- **Loading from a URL:** the Load button is disabled and shows progress while the request runs.
- **URL blocked or unreachable:** an alert that separates the cases it can tell apart: an HTTP error status, a
  request the browser blocked (CORS or network, which the browser reports the same way), and a link that isn't
  `https://`.
- **Update available:** after Check for update finds a higher revision, a confirmation that shows both
  revisions.
- **Replacing a pack:** a confirmation dialog that shows the loaded and the new revision.
- **Storage unavailable:** a notice that packs will be forgotten when the page closes.
- **Shared link with different packs:** a notice that lists the expected and the loaded fingerprints.

The import control is a real `<input type="file" accept="application/json,.json">` with a visible label, so it
works with the keyboard and with screen readers. Drag and drop onto the section can be added later; it isn't
part of this spec.

## Engine and data changes

- `src/engine/career-pack.ts`:
  - `CareerPackSchema`
  - `parseCareerPack(data: unknown)`, which returns the careers that passed and the errors
  - `packFingerprint(pack): Promise<string>`, using `crypto.subtle.digest`
- `src/engine/career-schema.ts`: `loadCareers` takes careers from several sources (bundled files and packs) and
  keeps its first-wins rule for duplicate ids.
- `src/storage/fetch-pack.ts`: `fetchCareerPack(url)`, which accepts only `https:` URLs, fetches the URL, and
  returns the parsed JSON or a typed error (`not-https`, `http-status`, `blocked-or-offline`, `not-json`).
- `src/storage/career-packs.ts`: read, write and remove packs in `localStorage`, with try/catch around each call,
  and an in-memory fallback. Each saved pack records where it came from (`file` or its URL).
- `scripts/validate-pack.ts` and a `validate-pack` npm script.
- A build step that writes `public/career-pack.schema.json` from the zod schemas.
- `.gitignore`: add `careers-private/`.
- `e2e/fixtures/`: invented test packs (valid, partly invalid, wrong format, later version). URL tests serve
  them through Playwright's `page.route`, so no test depends on an outside host.

## Acceptance criteria

- [x] With nothing imported, the Career data section lists no packs and the career list shows the sample career.
- [x] After a pack is imported, the sample career is no longer in the career list. After the last pack is
      removed, it is listed again.
- [x] Importing `e2e/fixtures/valid-pack.json` adds its careers to the career list and shows its name, revision,
      fingerprint and career count.
- [x] After a reload, the imported pack is still listed.
- [x] Clicking Remove on a pack removes its careers from the list, and they stay removed after a reload.
- [x] Importing a file that isn't JSON shows an alert naming the file, and nothing is saved.
- [x] Importing a pack with `formatVersion` 2 shows an alert saying the app supports version 1.
- [x] Importing a pack with one invalid career loads the others and lists the invalid one by index and field.
- [x] Importing a pack with an `id` that's already loaded asks for confirmation and shows both revisions.
      Cancelling keeps the old pack.
- [x] With `localStorage` blocked, an import still loads the pack for the visit and shows the storage notice.
- [x] Loading `https://packs.test/valid-pack.json` (served by `page.route`) adds its careers and shows the pack's
      source as URL.
- [x] Loading a URL whose route responds with status 404 shows an alert that includes the status.
- [x] Loading a URL whose route is aborted shows the alert for a blocked or unreachable link.
- [x] Entering an `http://` URL shows an alert saying only `https://` links are accepted, and no request is made.
- [x] Check for update on a URL pack whose route now serves a higher revision asks to replace it, and shows
      both revisions.
- [x] Check for update on a URL pack whose route serves changed content with the same revision asks to
      replace it and says the revision was not raised.
- [x] Two packs that define the same career id, imported in either order, keep the career from the pack whose
      `id` sorts first and report the duplicate.
- [x] A pack career with the id `sample-sanitation` is listed after import.
- [x] With an import's storage write made to throw `QuotaExceededError`, the pack loads for the visit, the
      not-saved notice names it, and the packs saved before it are still listed after a reload.
- [x] A shared link with `?packs=` that doesn't match the loaded packs shows the mismatch notice, and Reroll
      still works.
- [x] The import control can be reached and used with the keyboard alone.
- [x] `npm run validate-pack e2e/fixtures/partly-invalid-pack.json` prints the same messages the app shows and
      exits with code 1. For the valid fixture it exits with code 0.

## Resolved questions

Answered by the owner on 2026-11-03:

1. **Loading from a URL:** yes, alongside file import (decision 5).
2. **Sample career:** hidden once a pack is loaded (decision 4). The sample is now an invented orbital
   sanitation career with three assignments.
3. **Shared links with different packs:** warn only (decision 6).
