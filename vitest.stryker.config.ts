import { defineConfig } from 'vitest/config'

// The Vitest config that Stryker (npm run test:mutation) uses. It runs the unit tests in src/engine
// except src/engine/invariants.test.ts: the seed sweeps build hundreds of careers, which takes longer
// than Vitest's 5 second test timeout once Stryker has instrumented the engine. Leaving them out means a
// mutant that only the sweeps would catch is reported as survived.
export default defineConfig({
  test: {
    include: ['src/engine/**/*.test.ts'],
    exclude: ['src/engine/invariants.test.ts'],
  },
})
