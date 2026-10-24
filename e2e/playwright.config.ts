import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env['CI']);

/**
 * In CI: Playwright's own Chromium. On a Windows machine that blocks unsigned binaries the
 * downloaded browser will not start, so locally we drive the installed (signed) Edge instead.
 * Override with PW_CHANNEL=chrome or PW_CHANNEL=chromium.
 */
const channel = process.env['PW_CHANNEL'] ?? (CI ? undefined : 'msedge');

export default defineConfig({
  testDir: 'tests',
  // The demo shares one in-memory platform: run in order, one browser at a time.
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 860 },
    ...(channel && channel !== 'chromium' ? { channel } : {}),
  },
  webServer: [
    {
      command: 'pnpm --dir ../apps/api start',
      url: 'http://127.0.0.1:8787/health',
      env: { VEX_DB: 'memory', VEX_PROVIDER: 'scripted', PORT: '8787', VEX_RATE_LIMIT: '200' },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      // A third-party tool Vex has no code for, described only by its OpenAPI document.
      command: 'pnpm --dir ../apps/sample-tools citas',
      url: 'http://127.0.0.1:8790/openapi.json',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --dir ../apps/operator-demo dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
