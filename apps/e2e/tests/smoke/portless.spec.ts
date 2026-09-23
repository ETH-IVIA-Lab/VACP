import { RouteStore } from 'portless';
import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { freePort, stopProcess } from '../helpers/process';
import { repoRoot } from '../helpers/paths';

const exec = promisify(execFile);

const surfaces = [
  { name: 'docs.vacp', path: '/integrate/', kind: 'docs' },
  { name: 'examples.vacp', path: '/', kind: 'gallery' },
  { name: 'vega-lite.examples.vacp', path: '/', kind: 'example' },
  { name: 'vgplot.examples.vacp', path: '/', kind: 'example' },
  { name: 'react-dashboard.examples.vacp', path: '/', kind: 'example' },
  { name: 'athletes.examples.vacp', path: '/', kind: 'example' },
  { name: 'cars-parcoords.examples.vacp', path: '/', kind: 'example' },
];

test('Portless routes docs, gallery and standalone examples with working HMR', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const stateDir = await mkdtemp(join(tmpdir(), 'vacp-portless-'));
  const port = await freePort();
  const routes = new RouteStore(stateDir);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORTLESS: '1',
    PORTLESS_STATE_DIR: stateDir,
    PORTLESS_PORT: String(port),
    PORTLESS_HTTPS: '0',
    PORTLESS_SYNC_HOSTS: '0',
    PORTLESS_LAN: '0',
    PORTLESS_TLD: 'localhost',
    PORTLESS_TAILSCALE: '0',
    PORTLESS_FUNNEL: '0',
    PORTLESS_NGROK: '0',
    PORTLESS_APP_PORT: undefined,
    PORT: undefined,
    BROWSER: 'none',
    VACP_VITE_CACHE_DIR: `node_modules/.vite-portless-${port}`,
  };
  let stopApps: (() => Promise<void>) | undefined;
  const log = createWriteStream(testInfo.outputPath('dev-all.log'));

  try {
    await exec('pnpm', ['exec', 'portless', 'proxy', 'start'], { cwd: repoRoot, env, timeout: 20_000 });
    const apps = spawn('make', ['dev-all'], {
      cwd: repoRoot,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apps.stdout.pipe(log, { end: false });
    apps.stderr.pipe(log, { end: false });
    stopApps = () => stopProcess(apps);

    await expect.poll(() => routes.loadRoutes().length, { timeout: 30_000 }).toBe(surfaces.length);
    const docsSuffix = 'docs.vacp.localhost';
    const docsRoute = routes
      .loadRoutes()
      .find((route) => route.hostname === docsSuffix || route.hostname.endsWith(`.${docsSuffix}`));
    if (!docsRoute) throw new Error('Missing docs route');
    const worktreePrefix = docsRoute.hostname.slice(0, -docsSuffix.length);

    for (const surface of surfaces) {
      const hostname = `${worktreePrefix}${surface.name}.localhost`;
      expect(routes.loadRoutes().some((route) => route.hostname === hostname)).toBe(true);
      const page = await browser.newPage();
      let connected = false;
      page.on('websocket', (socket) => {
        if (new URL(socket.url()).hostname !== hostname) return;
        socket.on('framereceived', ({ payload }) => {
          if (String(payload).includes('"type":"connected"')) connected = true;
        });
      });
      try {
        await expect
          .poll(
            async () => {
              try {
                const response = await page.goto(`http://${hostname}:${port}${surface.path}`, {
                  waitUntil: 'domcontentloaded',
                  timeout: 3_000,
                });
                return response?.status() ?? 0;
              } catch {
                return 0;
              }
            },
            { timeout: 45_000, message: `Route ${hostname} becomes ready` },
          )
          .toBe(200);
        if (surface.kind === 'docs') {
          await expect(page.locator('.vp-doc h1')).toHaveText('Connect an analytical source');
        } else if (surface.kind === 'gallery') {
          await expect(page.locator('.gallery-card')).toHaveCount(
            surfaces.filter((surface) => surface.kind === 'example').length,
          );
        } else {
          await page.waitForFunction(() => Boolean(window.__vacp));
        }
        await expect.poll(() => connected, { message: `HMR connects through ${hostname}` }).toBe(true);
      } finally {
        await page.close();
      }
    }
    await stopApps();
    await expect
      .poll(() => routes.loadRoutes(), { timeout: 10_000, message: 'All app routes are released after shutdown' })
      .toEqual([]);
  } finally {
    await stopApps?.();
    await exec('pnpm', ['exec', 'portless', 'proxy', 'stop'], { cwd: repoRoot, env, timeout: 10_000 });
    log.end();
    await rm(stateDir, { recursive: true, force: true });
  }
});
