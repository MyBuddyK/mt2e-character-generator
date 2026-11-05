import { describe, expect, it } from 'vitest'
import { buildCriteriaCoverage } from './criteria-coverage'

const SPEC = {
  path: 'docs/features/demo.md',
  text: '# Demo feature\n\n- [x] **DM-1** First criterion.\n- [ ] **DM-2** Second criterion,\n  which goes on.\n',
}

// Tests for buildCriteriaCoverage in scripts/criteria-coverage.ts, run on in-memory files.
describe('buildCriteriaCoverage', () => {
  // Passes one spec with two criteria and one test file whose test names DM-1, and expects a row for each
  // criterion: DM-1 ticked with the test's file and title, DM-2 not ticked with "none" and only its first line.
  it('lists each criterion with the tests that name it, or none', () => {
    const test = {
      path: 'src/demo.test.ts',
      text: "// Checks the first thing.\n// Criteria: DM-1.\nit('does the first thing', () => {})\n",
    }
    const table = buildCriteriaCoverage([SPEC, test])
    expect(table).toContain('1 feature specs, 2 criteria, 1 named by at least one test.')
    expect(table).toContain('## Demo feature')
    expect(table).toContain('| DM-1 | yes | First criterion. | `src/demo.test.ts` does the first thing |')
    expect(table).toContain('| DM-2 | no | Second criterion, | none |')
  })

  // Passes a test file where two tests name the same criterion, one through a comment that names two ids,
  // and expects both tests in that criterion's row, joined by <br>.
  it('lists every test that names a criterion', () => {
    const test = {
      path: 'e2e/demo.spec.ts',
      text: "// a\n// Criteria: DM-1, DM-2.\ntest('a', async () => {})\n// b\n// Criteria: DM-1.\ntest(\"b\", async () => {})\n",
    }
    const table = buildCriteriaCoverage([SPEC, test])
    expect(table).toContain('| DM-1 | yes | First criterion. | `e2e/demo.spec.ts` a<br>`e2e/demo.spec.ts` b |')
    expect(table).toContain('| DM-2 | no | Second criterion, | `e2e/demo.spec.ts` a |')
  })

  // Passes a Criteria comment in a file that is not a test file and one in a test file whose next line has no
  // test call, and expects the first ignored and the second listed with the placeholder title.
  it('reads Criteria comments only in test files and marks a missing title', () => {
    const notTest = { path: 'src/demo.ts', text: '// Criteria: DM-2.\nexport const x = 1\n' }
    const test = { path: 'src/demo.test.ts', text: '// Criteria: DM-1.\nconst helper = 1\n' }
    const table = buildCriteriaCoverage([SPEC, notTest, test])
    expect(table).toContain('| DM-1 | yes | First criterion. | `src/demo.test.ts` (title not on the next line) |')
    expect(table).toContain('| DM-2 | no | Second criterion, | none |')
  })

  // Passes a criterion longer than 100 characters that contains a pipe, and expects it cut to 100 characters
  // ending in "..." and the pipe escaped.
  it('shortens long criterion text and escapes pipes', () => {
    const long = `a | b ${'x'.repeat(120)}`
    const spec = { path: 'docs/features/long.md', text: `# Long\n\n- [x] **LG-1** ${long}\n` }
    const row = buildCriteriaCoverage([spec]).split('\n').find((l) => l.startsWith('| LG-1 '))
    expect(row).toBe(`| LG-1 | yes | a \\| b ${'x'.repeat(91)}... | none |`)
  })

  // Builds the table twice from the same files in a different order and expects the same text.
  it('gives the same output for the same files in any order', () => {
    const test = { path: 'src/demo.test.ts', text: "// Criteria: DM-1.\nit('t', () => {})\n" }
    expect(buildCriteriaCoverage([test, SPEC])).toBe(buildCriteriaCoverage([SPEC, test]))
  })
})
