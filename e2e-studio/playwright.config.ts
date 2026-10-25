import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env['CI']);

/**
 * Locally, the installed (signed) Edge: the Chromium Playwright downloads does not start on a
 * machine that blocks unsigned binaries. Ports differ from development so both can run at once.
 */
const channel = process.env['PW_CHANNEL'] ?? (CI ? undefined : 'msedge');

export const PORTS = { server: 8798, studio: 5190, host: 5191, intruder: 5192 } as const;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORTS.studio}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    ...(channel && channel !== 'chromium' ? { channel } : {}),
  },
  webServer: [
    {
      // The embeddable script must exist before the server starts serving it.
      command: `pnpm --dir ../packages/runtime build && pnpm --dir ../apps/server start`,
      url: `http://127.0.0.1:${PORTS.server}/health`,
      env: {
        PORT: String(PORTS.server),
        STUDIO_DB: 'memory',
        STUDIO_DEV_LOGIN: '1',
        STUDIO_ASSISTANT: 'heuristic',
        STUDIO_ORIGIN: `http://localhost:${PORTS.studio}`,
        STUDIO_PUBLIC_URL: `http://localhost:${PORTS.server}`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --dir ../apps/studio exec vite --port ${PORTS.studio} --strictPort`,
      url: `http://localhost:${PORTS.studio}`,
      env: { STUDIO_API: `http://127.0.0.1:${PORTS.server}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // A customer's site (authorized) and someone else's site (not authorized).
      command: `node host-server.ts ${PORTS.host} ${PORTS.intruder}`,
      url: `http://localhost:${PORTS.host}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
