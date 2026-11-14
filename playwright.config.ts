import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production demo build (PGlite in a Web Worker) — exactly what GitHub Pages serves.
const channel = process.env.PW_CHANNEL; // e.g. "chrome" to reuse the system browser locally

export default defineConfig({
  testDir: './e2e',
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4178/omborchi/',
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'Asia/Tashkent',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}), viewport: { width: 1366, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(channel ? { channel } : {}) } },
  ],
  webServer: {
    command: 'npm run preview:demo -w @omborchi/web',
    url: 'http://localhost:4178/omborchi/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
