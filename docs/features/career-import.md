# Career file import

Status: proposed. Nothing in this spec is built yet.

## Problem

The public site can only include the invented sample career. Under item 3 of Mongoose Publishing's Fair Use
Policy, the real career tables must stay out of the public repo. The referee builds a career file from their own
books and shares it privately with their players. Each player needs a way to load that file into the public site
and keep it between visits.

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
   field, and the valid ones still load. This is the same rule `loadCareers` uses for bundled files. A career id
   used by more than one loaded pack, or by the sample, is reported, and only the first one loaded is kept.

3. **Storage stays in the player's browser.** Packs are saved in `localStorage` under one key,
   `mt2e.careerPacks.v1`, as the raw pack JSON plus the time it was imported. The app never sends a pack over
   the network. Every read and write is wrapped in try/catch. If storage is unavailable (private browsing,
   blocked site data), packs stay loaded for that visit only, and the app says so.

4. **The sample career stays available, but labelled.** The sample is always listed and marked "Sample", so the
   site works with nothing imported. Once a pack is loaded, the sample is listed after the pack careers.

5. **Seeds record which data they used.** A character rolled from a seed depends on the career data as well as
   the seed. The app computes a short fingerprint for each loaded pack: the first 8 hex characters of the
   SHA-256 of the pack's JSON in a fixed key order. The fingerprint is added to the shared URL as
   `?packs=<id>@<fingerprint>,...`. When someone opens a link and their loaded packs differ, the app warns that
   the results may not match the referee's.

6. **Authoring help for the referee.**
   - A JSON Schema generated from the zod schemas with `z.toJSONSchema`, published with the site as
     `career-pack.schema.json`. Editors such as VS Code then show completions and errors while typing a pack.
   - `npm run validate-pack <file>`, which prints the same messages the app would show.
   - A git-ignored `careers-private/` folder in the repo for the referee's own packs, so they can't be committed
     by accident.

## User flow

1. The referee writes a pack from their books in `careers-private/`, checks it with `npm run validate-pack`, and
   sends the file to their players (Discord, email, a shared drive).
2. A player opens the site and opens the **Career data** section.
3. The player clicks **Import career pack** and picks the file.
4. The app checks the file and shows the result: the pack name, its revision, its fingerprint, how many careers
   loaded, and any problems.
5. The careers appear in the career list, and the pack is saved in the player's browser.
6. On later visits, the pack is still loaded. The player can remove it or import a newer revision.

## UI

A **Career data** section above the career list:

```
Career data                                   [Import career pack]
─────────────────────────────────────────────────────────────────
Core careers      rev 3   fp 1a2b3c4d   12 careers      [Remove]
Supplement 4      rev 1   fp 9f8e7d6c    5 careers      [Remove]
Sample            built in               1 career
─────────────────────────────────────────────────────────────────
Packs are stored only in this browser. Nothing is uploaded.
```

States:

- **Nothing imported:** only the Sample row, plus a line explaining that the referee can share a career pack.
- **Import succeeded with problems:** the pack row, plus a list of skipped careers and their messages.
- **Import failed:** an alert naming the file and the reason (not JSON, wrong `format`, later `formatVersion`, no
  valid careers). Nothing is saved.
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
- `src/storage/career-packs.ts`: read, write and remove packs in `localStorage`, with try/catch around each call,
  and an in-memory fallback.
- `scripts/validate-pack.ts` and a `validate-pack` npm script.
- A build step that writes `public/career-pack.schema.json` from the zod schemas.
- `.gitignore`: add `careers-private/`.
- `e2e/fixtures/`: invented test packs (valid, partly invalid, wrong format, later version).

## Acceptance criteria

- [ ] With nothing imported, the Career data section lists only the Sample row.
- [ ] Importing `e2e/fixtures/valid-pack.json` adds its careers to the career list and shows its name, revision,
      fingerprint and career count.
- [ ] After a reload, the imported pack is still listed.
- [ ] Clicking Remove on a pack removes its careers from the list, and they stay removed after a reload.
- [ ] Importing a file that isn't JSON shows an alert naming the file, and nothing is saved.
- [ ] Importing a pack with `formatVersion` 2 shows an alert saying the app supports version 1.
- [ ] Importing a pack with one invalid career loads the others and lists the invalid one by index and field.
- [ ] Importing a pack with an `id` that's already loaded asks for confirmation and shows both revisions.
      Cancelling keeps the old pack.
- [ ] With `localStorage` blocked, an import still loads the pack for the visit and shows the storage notice.
- [ ] A shared link with `?packs=` that doesn't match the loaded packs shows the mismatch notice.
- [ ] The import control can be reached and used with the keyboard alone.
- [ ] `npm run validate-pack e2e/fixtures/partly-invalid-pack.json` prints the same messages the app shows and
      exits with code 1. For the valid fixture it exits with code 0.

## Open questions

1. **Loading from a URL:** should players also be able to load a pack from a link, such as a private file share?
   This depends on the host allowing cross-origin requests, so the spec leaves it out for now.
2. **Hiding the sample:** should the Sample career be hidden once a pack is loaded, or always listed?
3. **Referee lock:** should a shared link be able to require specific packs (refuse to roll without them), or
   only warn as in decision 5?
