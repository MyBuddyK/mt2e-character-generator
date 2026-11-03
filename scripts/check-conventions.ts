import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** One file to check: its repo-relative path and its text. */
export interface SourceFile {
  path: string
  text: string
}

/**
 * Words and phrases the documentation rules in CLAUDE.md rule out, matched as whole words and
 * ignoring case. "clean" is left out because the docs use it as a verb ("clean them up").
 */
export const BANNED_PHRASES: readonly string[] = [
  'robust',
  'elegant',
  'powerful',
  'comprehensive',
  'best practice',
  'best practices',
  'seamless',
  'seamlessly',
  'state-of-the-art',
  'cutting-edge',
  'world-class',
  'battle-tested',
  'blazing',
  'production-ready',
]

/**
 * Files the banned phrase and skipped test checks leave out, because they name the phrases and the
 * skip calls on purpose.
 */
export const RULE_LIST_FILES: readonly string[] = ['CLAUDE.md', 'scripts/check-conventions.ts', 'scripts/check-conventions.test.ts']

const EXPORT_DECLARATION = /^export (default )?(async )?(function|const|let|type|interface|class|enum)\b/
const SKIPPED_TEST = /\b(it|test|describe|test\.describe)\.(skip|fixme|only|todo)\b/
const TEST_CALL = /^\s*(it|test|describe|test\.describe)(\.(each|concurrent|serial|parallel)\b[^(]*\([^)]*\))?\(/

const CRITERION_LINE = /^- \[([x ])\] (?:\*\*([A-Z]+-\d+)\*\* )?/
const CRITERIA_COMMENT = /^\s*\/\/ Criteria: (.+)\.$/
const CRITERION_ID = /^[A-Z]+-\d+$/

/**
 * Returns the traceability problems in `files`, as `path:line: message`:
 * - in a Markdown file under `docs/features/`, an acceptance criterion line (`- [x] ` or `- [ ] `) that
 *   does not start with a bold id such as `**CT-4**`, or an id used twice;
 * - a ticked (`[x]`) criterion whose id no `// Criteria: ...` comment in a test file names;
 * - a `// Criteria: ...` comment in a test file that names an id no feature spec defines.
 */
function findTraceProblems(files: readonly SourceFile[]): string[] {
  const problems: string[] = []
  const defined = new Map<string, { where: string; ticked: boolean }>()
  const named = new Map<string, string>()
  for (const file of files) {
    const isSpec = file.path.startsWith('docs/features/') && file.path.endsWith('.md')
    const isTest = /\.(test|spec)\.ts$/.test(file.path)
    file.text.split('\n').forEach((line, i) => {
      const where = `${file.path}:${i + 1}`
      const criterion = isSpec ? CRITERION_LINE.exec(line) : null
      if (criterion) {
        const id = criterion[2]
        if (id === undefined) problems.push(`${where}: acceptance criterion has no id such as **CT-1**`)
        else if (defined.has(id)) problems.push(`${where}: criterion id ${id} is also used at ${defined.get(id)?.where ?? ''}`)
        else defined.set(id, { where, ticked: criterion[1] === 'x' })
      }
      const comment = isTest ? CRITERIA_COMMENT.exec(line) : null
      for (const id of comment?.[1]?.split(', ') ?? []) {
        if (CRITERION_ID.test(id)) named.set(id, where)
        else problems.push(`${where}: "${id}" is not a criterion id such as CT-1`)
      }
    })
  }
  for (const [id, { where, ticked }] of defined) {
    if (ticked && !named.has(id)) problems.push(`${where}: ticked criterion ${id} is not named by any test's Criteria comment`)
  }
  for (const [id, where] of named) {
    if (!defined.has(id)) problems.push(`${where}: criterion ${id} is not defined in docs/features`)
  }
  return problems
}

/** Returns true when the last non-blank line before `index` in `lines` ends a block comment or is a line comment. */
function hasCommentAbove(lines: string[], index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? '').trim()
    if (line === '') continue
    return line.endsWith('*/') || line.startsWith('//')
  }
  return false
}

/**
 * Returns one message for each problem the documentation and test rules in CLAUDE.md name that a
 * script can find in `files`, as `path:line: message`, or an empty list when there are none:
 * - in a `.ts` or `.tsx` file, an exported function, constant, type, interface, class or enum
 *   declared at the start of a line with no comment directly above it;
 * - in a `.ts` file whose name ends in `.test.ts` or `.spec.ts`, an `it`, `test` or `describe` call
 *   at the start of a line with no comment directly above it, and any `.skip`, `.fixme`, `.only` or
 *   `.todo` on one of those calls (oxlint finds these in Vitest files but not in Playwright specs);
 * - a phrase from BANNED_PHRASES in any file;
 * - a traceability problem between the acceptance criteria in `docs/features/` and the
 *   `// Criteria: CT-1, CT-2.` comments in test files (an id missing, used twice, unknown, or a
 *   ticked criterion that no test names).
 * The skipped test and phrase checks leave out the files in RULE_LIST_FILES.
 * It does not check whether a comment is accurate or complete; that is left to review.
 */
export function findConventionProblems(files: readonly SourceFile[]): string[] {
  const problems: string[] = []
  const phrases = new RegExp(`\\b(${BANNED_PHRASES.map((p) => p.replace(/[-]/g, '\\-')).join('|')})\\b`, 'i')
  for (const file of files) {
    const lines = file.text.split('\n')
    const isCode = /\.tsx?$/.test(file.path)
    const isTest = /\.(test|spec)\.ts$/.test(file.path)
    const checkText = !RULE_LIST_FILES.includes(file.path)
    lines.forEach((line, i) => {
      const where = `${file.path}:${i + 1}`
      if (isCode && EXPORT_DECLARATION.test(line) && !hasCommentAbove(lines, i)) {
        problems.push(`${where}: exported declaration has no comment above it`)
      }
      if (isTest && TEST_CALL.test(line) && !hasCommentAbove(lines, i)) {
        problems.push(`${where}: test or describe block has no comment above it`)
      }
      if (isTest && checkText && SKIPPED_TEST.test(line)) problems.push(`${where}: skipped, focused or todo test`)
      const match = checkText ? phrases.exec(line) : null
      if (match) problems.push(`${where}: evaluative phrase "${match[0]}"`)
    })
  }
  return [...problems, ...findTraceProblems(files)]
}

/**
 * Usage: npm run check:conventions
 *
 * Lists the files git tracks that end in .ts, .tsx or .md, runs findConventionProblems on them, and prints
 * each problem. Returns 1 when there is at least one problem and 0 otherwise.
 */
function main(): number {
  const paths = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.md'], { encoding: 'utf8' })
    .split('\n')
    .filter((p) => p !== '')
  const problems = findConventionProblems(paths.map((path) => ({ path, text: readFileSync(path, 'utf8') })))
  for (const problem of problems) console.error(problem)
  console.log(`check-conventions: ${paths.length} files, ${problems.length} problem${problems.length === 1 ? '' : 's'}.`)
  return problems.length === 0 ? 0 : 1
}

if (process.argv[1]?.endsWith('check-conventions.ts')) process.exitCode = main()
