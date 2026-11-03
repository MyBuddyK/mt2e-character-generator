import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const isCI = Boolean(process.env['CI'])
const chromiumPath = process.env['PW_CHROMIUM_PATH']
// The same BASE_PATH that vite.config.ts builds with, normalized to start and end with '/'. Specs use
// relative URLs such as './?seed=x', so they resolve under this path.
const basePath = `/${(process.env['BASE_PATH'] ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/\/+/g, '/')

// When PW_CHROMIUM_PATH is set, Playwright launches that Chromium binary instead of the one
// `playwright install` downloads. When it is unset, Playwright uses its default browser.
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : {}

// Runs the specs in ./e2e against a production build served by `vite preview` at basePath, in a
// desktop Chrome project and a Pixel 7 project. It always starts its own server, and fails if port
// 4173 is already in use. In CI it retries failed tests twice, fails on `test.only`, and writes
// GitHub annotations plus an HTML report.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}${basePath}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${basePath}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
