import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { exampleDir, repoRoot } from './paths';

/**
 * Applications Playwright serves once for the whole run. Explicit ports let the configuration and
 * every worker agree on each URL without coordination. `VACP_E2E_PORT` moves the whole range.
 *
 * Each command starts the server binary itself. Package scripts wrap it in pnpm and Portless,
 * whose children outlive Playwright's shutdown signal and keep a finished run waiting.
 */
const vp = (command: 'dev' | 'preview') => `node_modules/.bin/vp ${command}`;
const applications = {
  'athlete-explorer': { cwd: exampleDir('athlete-explorer'), command: vp('dev'), dev: true },
  gallery: { cwd: exampleDir('gallery'), command: `pnpm generate && ${vp('dev')}`, dev: true },
  'cars-parallel-coords': { cwd: exampleDir('cars-parallel-coords'), command: vp('dev'), dev: true },
  'react-dashboard': { cwd: exampleDir('react-dashboard'), command: vp('dev'), dev: true },
  'vega-lite-gallery': { cwd: exampleDir('vega-lite-gallery'), command: vp('dev'), dev: true },
  'vgplot-gallery': { cwd: exampleDir('vgplot-gallery'), command: vp('dev'), dev: true },
  // Served from `make build-apps` output, as people receive them.
  'gallery-build': { cwd: exampleDir('gallery'), command: vp('preview'), dev: false },
  docs: { cwd: resolve(repoRoot, 'apps/docs'), command: 'node_modules/.bin/vitepress preview .', dev: false },
} as const;

export type AppName = keyof typeof applications;
export type AppServer = { name: AppName; cwd: string; command: string; dev: boolean; port: number; url: string };

const firstPort = Number(process.env.VACP_E2E_PORT ?? 4310);
if (!Number.isInteger(firstPort) || firstPort < 1024) throw new Error('VACP_E2E_PORT must be a port number');

export const appServers: readonly AppServer[] = Object.entries(applications).map(([name, app], index) => ({
  name: name as AppName,
  ...app,
  port: firstPort + index,
  url: `http://127.0.0.1:${firstPort + index}/`,
}));

/** The shared server for one application. Servers hold no application state between page loads. */
export function appServer(name: AppName): AppServer {
  return appServers.find((server) => server.name === name)!;
}

/**
 * How long a page may take to install its bridge and tools. DuckDB-backed examples load WebAssembly
 * first, which takes several seconds when parallel workers start them together.
 */
export const appReady = { timeout: 30_000 } as const;

/** Open `path` on the application's shared server and wait until the page installs its VACP bridge. */
export async function gotoApp(page: Page, name: AppName, path = ''): Promise<AppServer> {
  const server = appServer(name);
  await page.goto(new URL(path, server.url).href);
  await page.waitForFunction(() => !!window.__vacp, undefined, appReady);
  return server;
}
