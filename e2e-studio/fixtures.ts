import { fileURLToPath } from 'node:url';
import { test as base, chromium, devices, expect, type BrowserContext } from '@playwright/test';

/**
 * On this Windows machine the tests drive the installed Edge, and the security suite (ESET)
 * shields every profile Edge writes to, even Playwright's temporary one, from other processes:
 * Playwright then spends ~26 minutes retrying to delete it after the last test. So locally the
 * browser runs on a persistent profile in e2e-studio/.profile (gitignored) that nobody deletes.
 * In CI, with Playwright's own Chromium, the default fixtures stay.
 */
const PERSISTENT = !process.env['CI'] && (process.env['PW_CHANNEL'] ?? 'msedge') === 'msedge';
const PROFILE = fileURLToPath(new URL('./.profile/', import.meta.url));

export async function openContext(): Promise<BrowserContext> {
  const { defaultBrowserType: _ignored, ...desktop } = devices['Desktop Chrome']!;
  return chromium.launchPersistentContext(PROFILE, { ...desktop, channel: 'msedge', headless: true, locale: 'es-ES', viewport: { width: 1440, height: 900 } });
}

// Decided once at load: depending on the default `context` here would launch Playwright's own
// browser (and its temporary profile) even when it goes unused.
export const test = PERSISTENT
  ? base.extend<{ context: BrowserContext }>({
      context: async ({}, use) => {
        const persistent = await openContext();
        await use(persistent);
        await persistent.close();
      },
    })
  : base;

export { expect };
