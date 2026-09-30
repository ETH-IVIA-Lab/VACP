import { defineConfig, devices } from '@playwright/test';
import { appServers } from './tests/helpers/servers';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
    // A zone with daylight saving keeps local and UTC clocks apart on every machine, CI included.
    timezoneId: 'America/Los_Angeles',
  },
  projects: [
    // Each development server optimizes dependencies on its first visit; warming them first keeps
    // that one-time reload out of parallel tests.
    { name: 'warm', testMatch: /warm\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testMatch: /\.spec\.ts$/,
      dependencies: ['warm'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: appServers.map((server) => ({
    name: server.name,
    command: `${server.command} --host 127.0.0.1 --port ${server.port} --strictPort`,
    cwd: server.cwd,
    url: server.url,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORTLESS: '0',
      BROWSER: 'none',
      // Kept apart from the cache of a `pnpm dev` session running beside the tests.
      VACP_VITE_CACHE_DIR: 'node_modules/.vite-e2e',
    },
  })),
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
});
