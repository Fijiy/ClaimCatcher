import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Seam 1: unit tests next to the code they cover (`src/**/*.test.ts`), and
// the quality gates' own scoring and harness (`scripts/eval/*.test.ts`).
// Seam 2 (Playwright, `tests/e2e`) is run by `pnpm test:e2e`, not here.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
