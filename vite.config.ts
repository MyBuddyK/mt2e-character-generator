/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves the site from /<repo-name>/. Set BASE_PATH in CI; local dev uses '/'.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
