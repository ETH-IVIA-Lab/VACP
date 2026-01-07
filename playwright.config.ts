import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  timeout: 90_000,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  reporter: [['list']],
});
