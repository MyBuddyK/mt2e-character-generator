import { describe, expect, it } from 'vitest'
import { findConventionProblems } from './check-conventions'

// Tests for findConventionProblems in scripts/check-conventions.ts, run on in-memory files.
describe('findConventionProblems', () => {
  // Passes an exported function with a JSDoc comment and one with a line comment, and expects no problems.
  it('accepts exports with a comment above them', () => {
    const text = '/** Returns 1. */\nexport function one() { return 1 }\n\n// Two.\nexport const TWO = 2\n'
    expect(findConventionProblems([{ path: 'src/a.ts', text }])).toEqual([])
  })

  // Passes an exported function and an exported type with no comment, and expects one problem for each
  // with its line number.
  it('reports exports with no comment above them', () => {
    const text = 'const x = 1\nexport function one() { return x }\nexport type T = number\n'
    expect(findConventionProblems([{ path: 'src/a.ts', text }])).toEqual([
      'src/a.ts:2: exported declaration has no comment above it',
      'src/a.ts:3: exported declaration has no comment above it',
    ])
  })

  // Passes a test file with a commented describe and an uncommented it, and expects a problem for the it only.
  it('reports test blocks with no comment above them', () => {
    const text = "// Group.\ndescribe('g', () => {\n  it('a', () => {})\n})\n"
    expect(findConventionProblems([{ path: 'e2e/a.spec.ts', text }])).toEqual([
      'e2e/a.spec.ts:3: test or describe block has no comment above it',
    ])
  })

  // Passes a Playwright spec with commented test.skip and test.fixme calls, and expects a problem for each.
  it('reports skipped and fixme tests', () => {
    const text = "// a\ntest.skip('a', async () => {})\n// b\ntest.fixme('b', async () => {})\n"
    expect(findConventionProblems([{ path: 'e2e/a.spec.ts', text }])).toEqual([
      'e2e/a.spec.ts:2: skipped, focused or todo test',
      'e2e/a.spec.ts:4: skipped, focused or todo test',
    ])
  })

  // Passes the same uncommented it call in a file that isn't a test file, and expects no problems.
  it('checks test blocks only in .test.ts and .spec.ts files', () => {
    expect(findConventionProblems([{ path: 'src/a.ts', text: "it('a', () => {})\n" }])).toEqual([])
  })

  // Passes a Markdown line with "Robust" and one with "best practice", and expects a problem naming each phrase.
  it('reports evaluative phrases in any case', () => {
    const text = 'A Robust parser.\nFollows best practice.\n'
    expect(findConventionProblems([{ path: 'README.md', text }])).toEqual([
      'README.md:1: evaluative phrase "Robust"',
      'README.md:2: evaluative phrase "best practice"',
    ])
  })

  // Passes "robustness" and the same phrase in CLAUDE.md, and expects no problems: the check matches whole
  // words, and CLAUDE.md lists the phrases on purpose.
  it('matches whole words and skips CLAUDE.md', () => {
    expect(findConventionProblems([{ path: 'docs/a.md', text: 'robustness\n' }])).toEqual([])
    expect(findConventionProblems([{ path: 'CLAUDE.md', text: 'no "robust"\n' }])).toEqual([])
  })
})
