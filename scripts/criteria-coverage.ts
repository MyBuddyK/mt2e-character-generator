import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  CRITERION_ID,
  isFeatureSpec,
  isTestFile,
  parseCriteriaComment,
  parseCriterionLine,
  TEST_CALL,
  type SourceFile,
} from './check-conventions'

/** Repo-relative path of the generated criteria coverage table. */
export const COVERAGE_PATH = 'docs/criteria-coverage.md'

/** Longest criterion text, in characters, that the table prints before cutting it with "...". */
const MAX_TEXT = 100

/** A quoted string at the start of the text (after spaces), allowing backslash escapes such as \'. */
const QUOTED = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/
const SPEC_TITLE = /^# (.+)$/

/** One test block that names a criterion: its file and its title. */
interface TestRef {
  path: string
  title: string
}

/** One acceptance criterion from a feature spec. */
interface Criterion {
  id: string
  ticked: boolean
  text: string
}

/** One feature spec: its path, its `# ` title and its criteria in file order. */
interface Spec {
  path: string
  title: string
  criteria: Criterion[]
}

/** Placeholder title for a Criteria comment whose next line is not a test call with a quoted title. */
export const NO_TITLE = '(no test title found after the comment)'

/** Compares two strings by UTF-16 code units, so the order does not depend on the locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Returns the Markdown `text` of a criterion for a table cell: cut to MAX_TEXT characters with "..." when it
 * is longer, with the cut moved back before an unclosed backtick or a trailing backslash so that no code
 * span or escape is left open, and with `|` escaped.
 */
function markdownCell(text: string): string {
  let short = text
  if (text.length > MAX_TEXT) {
    short = text.slice(0, MAX_TEXT - 3)
    const ticks = short.split('`').length - 1
    if (ticks % 2 === 1) short = short.slice(0, short.lastIndexOf('`'))
    short = `${short.replace(/\\+$/, '').trimEnd()}...`
  }
  return short.replace(/\|/g, '\\|')
}

/** Returns plain `text`, such as a test title, escaped for a Markdown table cell: backslash, backtick, `<` and `|`. */
function plainCell(text: string): string {
  return text.replace(/[\\`|]/g, (c) => `\\${c}`).replace(/</g, '&lt;')
}

/**
 * Returns the title of the test call that starts on `lines[index]`, or NO_TITLE when that line is not an
 * `it`, `test`, `describe` or `test.describe` call (with the `.each(...)`, `.concurrent`, `.serial` and
 * `.parallel` forms that TEST_CALL matches) followed by a quoted title on the same line or the next one.
 * Backslash escapes in the title are undone, so 'the player\'s term' gives "the player's term".
 */
function titleAt(lines: readonly string[], index: number): string {
  const line = lines[index] ?? ''
  const call = TEST_CALL.exec(line)
  if (!call) return NO_TITLE
  const rest = `${line.slice(call[0].length)}\n${lines[index + 1] ?? ''}`
  const quoted = QUOTED.exec(rest)?.[2]
  return quoted === undefined ? NO_TITLE : quoted.replace(/\\(.)/g, '$1')
}

/**
 * Returns the feature specs among `files` (Markdown files under `docs/features/`), sorted by path, each with
 * its title and every criterion line that has an id. A criterion's text is its first line only; lines that
 * continue it are left out.
 */
function readSpecs(files: readonly SourceFile[]): Spec[] {
  return files
    .filter((f) => isFeatureSpec(f.path))
    .sort((a, b) => byCodeUnit(a.path, b.path))
    .map((file) => {
      const lines = file.text.split('\n')
      const title = lines.map((l) => SPEC_TITLE.exec(l)?.[1]).find((t) => t !== undefined) ?? file.path
      const criteria: Criterion[] = []
      for (const line of lines) {
        const c = parseCriterionLine(line)
        if (c?.id !== undefined) criteria.push({ id: c.id, ticked: c.ticked, text: c.text })
      }
      return { path: file.path, title, criteria }
    })
}

/**
 * Returns, for each criterion id named by a `// Criteria: ...` comment in a `.test.ts` or `.spec.ts` file
 * among `files`, the test blocks that name it, with the title read by titleAt from the line after the
 * comment. Entries that are not ids (CRITERION_ID) are left out; the conventions check reports them.
 */
function readTestRefs(files: readonly SourceFile[]): Map<string, TestRef[]> {
  const refs = new Map<string, TestRef[]>()
  for (const file of [...files].sort((a, b) => byCodeUnit(a.path, b.path))) {
    if (!isTestFile(file.path)) continue
    const lines = file.text.split('\n')
    lines.forEach((line, i) => {
      const ids = (parseCriteriaComment(line) ?? []).filter((id) => CRITERION_ID.test(id))
      if (ids.length === 0) return
      const title = titleAt(lines, i + 1)
      for (const id of ids) refs.set(id, [...(refs.get(id) ?? []), { path: file.path, title }])
    })
  }
  return refs
}

/**
 * Returns the Markdown text of the criteria coverage table for `files`: one section per feature spec in
 * `docs/features/`, with a row per criterion giving its id, whether it is ticked, its first line of text,
 * and each test that names it as its file and title. Line numbers are left out so that editing
 * a test file does not change rows for tests that did not change. A criterion no test names shows "none". The text
 * depends only on `files`, so running it twice on the same files gives the same output.
 */
export function buildCriteriaCoverage(files: readonly SourceFile[]): string {
  const specs = readSpecs(files)
  const refs = readTestRefs(files)
  const total = specs.reduce((n, s) => n + s.criteria.length, 0)
  const named = specs.reduce((n, s) => n + s.criteria.filter((c) => refs.has(c.id)).length, 0)
  const out = [
    '# Acceptance criteria coverage',
    '',
    'Generated by `npm run criteria` from the criteria in `docs/features/` and the `// Criteria:` comments in',
    'test files. Do not edit it by hand: `npm run check` fails when it is out of date. A row lists the tests',
    'whose comment names the criterion; whether those tests check what the criterion says is left to review.',
    '',
    `${specs.length} feature specs, ${total} criteria, ${named} named by at least one test.`,
  ]
  for (const spec of specs) {
    out.push('', `## ${spec.title}`, '', `Spec: [\`${spec.path}\`](${spec.path.replace(/^docs\//, '')})`, '')
    out.push('| Id | Ticked | Criterion (first line) | Tests |', '| --- | --- | --- | --- |')
    for (const c of spec.criteria) {
      const tests = (refs.get(c.id) ?? []).map((r) => `\`${r.path}\` ${plainCell(r.title)}`)
      out.push(`| ${c.id} | ${c.ticked ? 'yes' : 'no'} | ${markdownCell(c.text)} | ${tests.length > 0 ? tests.join('<br>') : 'none'} |`)
    }
  }
  return `${out.join('\n')}\n`
}

/**
 * Usage: npm run criteria (writes the table) or npm run check:criteria (checks it).
 *
 * Reads the .md and .ts files git tracks or would track (untracked files that .gitignore does not
 * exclude), skipping any that are not on disk, such as a tracked file deleted but not yet staged, and builds the table with buildCriteriaCoverage. With `--check`,
 * compares it with the committed COVERAGE_PATH and returns 1, printing a message, when they differ or the
 * file is missing; otherwise returns 0. Without `--check`, writes the table to COVERAGE_PATH and returns 0.
 */
function main(): number {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts', '*.md'], {
    encoding: 'utf8',
  })
  const paths = [...new Set(listed.split('\n'))].filter((p) => p !== '' && p !== COVERAGE_PATH && existsSync(p))
  const table = buildCriteriaCoverage(paths.map((path) => ({ path, text: readFileSync(path, 'utf8') })))
  if (!process.argv.includes('--check')) {
    writeFileSync(COVERAGE_PATH, table)
    console.log(`criteria-coverage: wrote ${COVERAGE_PATH}.`)
    return 0
  }
  let committed = ''
  try {
    committed = readFileSync(COVERAGE_PATH, 'utf8')
  } catch {
    committed = ''
  }
  if (committed === table) {
    console.log(`criteria-coverage: ${COVERAGE_PATH} is up to date.`)
    return 0
  }
  console.error(`criteria-coverage: ${COVERAGE_PATH} is out of date. Run npm run criteria and commit the result.`)
  return 1
}

if (process.argv[1]?.endsWith('criteria-coverage.ts')) process.exitCode = main()
