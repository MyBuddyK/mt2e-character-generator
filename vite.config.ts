/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the React app with the URL prefix in the BASE_PATH environment variable, or '/' when it
// is unset. The Pages deploy workflow sets BASE_PATH to '/<repo-name>/'. Vitest runs the unit
// tests matching src/**/*.test.ts and scripts/**/*.test.ts.
export default defineConfig({
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
