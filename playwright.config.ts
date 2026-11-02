import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const isCI = Boolean(process.env['CI'])
const chromiumPath = process.env['PW_CHROMIUM_PATH']

// When PW_CHROMIUM_PATH is set, Playwright launches that Chromium binary instead of the one
// `playwright install` downloads. When it is unset, Playwright uses its default browser.
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : {}

// Runs the specs in ./e2e against a production build served by `vite preview`, in a desktop
// Chrome project and a Pixel 7 project. In CI it retries failed tests twice, fails on
// `test.only`, and writes GitHub annotations plus an HTML report.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
