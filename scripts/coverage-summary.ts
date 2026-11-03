import { readFileSync } from 'node:fs'

/** The four measures in coverage/coverage-summary.json, in the order the table lists them. */
export const MEASURES = ['lines', 'statements', 'functions', 'branches'] as const

/** One measure's totals as Vitest's json-summary reporter writes them. */
interface Totals {
  total: number
  covered: number
  pct: number
}

/**
 * Returns a Markdown table of the `total` entry of a coverage-summary.json value: one row per
 * measure in MEASURES with its percentage and covered / total counts. Throws when a measure is
 * missing or not shaped like Totals.
 */
export function coverageTable(summary: unknown): string {
  const total: unknown = typeof summary === 'object' && summary !== null ? Reflect.get(summary, 'total') : undefined
  const rows = MEASURES.map((measure) => {
    const entry: unknown = typeof total === 'object' && total !== null ? Reflect.get(total, measure) : undefined
    if (!isTotals(entry)) throw new Error(`coverage summary has no totals for ${measure}`)
    return `| ${measure} | ${entry.pct}% | ${entry.covered} / ${entry.total} |`
  })
  return ['| Measure | % | Covered |', '| --- | --- | --- |', ...rows].join('\n')
}

/** Returns true when `value` has numeric total, covered and pct fields. */
function isTotals(value: unknown): value is Totals {
  if (typeof value !== 'object' || value === null) return false
  return ['total', 'covered', 'pct'].every((key) => typeof Reflect.get(value, key) === 'number')
}

/**
 * Usage: tsx scripts/coverage-summary.ts
 *
 * Reads coverage/coverage-summary.json (written by npm run test:coverage) and prints a heading and
 * coverageTable's table. CI appends the output to the run's summary page.
 */
function main(): void {
  const summary: unknown = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'))
  console.log(`### Unit test coverage (src/engine, src/storage, scripts)\n\n${coverageTable(summary)}`)
}

if (process.argv[1]?.endsWith('coverage-summary.ts')) main()
