/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the React app with the URL prefix in the BASE_PATH environment variable, or '/' when it
// is unset. The Pages deploy workflow sets BASE_PATH to '/<repo-name>/'. Vitest runs the unit
// tests matching src/**/*.test.ts and scripts/**/*.test.ts. With --coverage (npm run test:coverage)
// it measures the TypeScript files under src/engine, src/storage and scripts, and writes a text
// summary, an HTML report and coverage/coverage-summary.json. The React components (.tsx) and hooks
// are left out because the Playwright specs test them, and v8 coverage does not record browser runs.
// No coverage threshold is set.
export default defineConfig({
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/storage/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
    },
  },
})
