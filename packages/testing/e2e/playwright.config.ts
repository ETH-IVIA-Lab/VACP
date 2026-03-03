import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  timeout: 90_000,
  retries: 0,
  // These tests spin up multiple Vite dev servers and in-browser DuckDB instances.
  // Running serially keeps end-to-end behavior deterministic across environments.
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  reporter: [['list']],
});
