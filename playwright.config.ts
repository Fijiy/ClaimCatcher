import { defineConfig } from '@playwright/test';

// Seam 2: the built extension in Chrome, against local fixture pages.
// `pnpm test:e2e` builds first; the tests load .output/chrome-mv3.
export default defineConfig({
  testDir: 'tests/e2e',
  // One Chrome profile per test; the extension's side panel and badge are
  // browser-wide, so tests don't share a browser.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'dot' : 'list',
});
