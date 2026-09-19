import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Tier 2 (Path-to-100 v2 · C10) — real-browser golden rendering.
 *
 * Runs the PDF-import renderer's HTML in actual Chromium to verify what jsdom
 * cannot: real layout + paint. NOT part of the default CI job — run with
 * `npm run test:e2e`.
 *
 * Browser resolution: this environment ships a pre-installed Chromium whose
 * build may not match the @playwright/test version, so we pin `executablePath`
 * to it when present (PW_CHROMIUM_PATH overrides). In a normal checkout where
 * `npx playwright install` has run, the file is absent and Playwright resolves
 * its own bundled browser.
 */
const PREINSTALLED_CHROMIUM = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const executablePath = existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;

export default defineConfig({
  testDir: './tests-e2e',
  testMatch: /.*\.e2e\.(spec\.)?ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['line']],
  use: {
    headless: true,
    trace: 'off',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
