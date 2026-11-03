import { describe, expect, it } from 'vitest'
import { coverageTable } from './coverage-summary'

/** Returns totals for one measure with `covered` of 10 covered. */
function totals(covered: number) {
  return { total: 10, covered, skipped: 0, pct: covered * 10 }
}

// Tests for coverageTable in scripts/coverage-summary.ts.
describe('coverageTable', () => {
  // Passes a summary with all four measures and expects a header, a separator and one row per measure
  // in the order lines, statements, functions, branches.
  it('writes one row per measure', () => {
    const summary = { total: { lines: totals(9), statements: totals(8), functions: totals(7), branches: totals(6) } }
    expect(coverageTable(summary).split('\n')).toEqual([
      '| Measure | % | Covered |',
      '| --- | --- | --- |',
      '| lines | 90% | 9 / 10 |',
      '| statements | 80% | 8 / 10 |',
      '| functions | 70% | 7 / 10 |',
      '| branches | 60% | 6 / 10 |',
    ])
  })

  // Passes a summary with no branches entry and expects an error naming branches.
  it('throws when a measure is missing', () => {
    const summary = { total: { lines: totals(9), statements: totals(8), functions: totals(7) } }
    expect(() => coverageTable(summary)).toThrow('coverage summary has no totals for branches')
  })
})
