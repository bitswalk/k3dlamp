import { defineConfig } from '@playwright/test';

const results = process.env.RESULTS_DIR ?? '/results';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 3 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: `${results}/test-results`,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `${results}/report` }]],
});
