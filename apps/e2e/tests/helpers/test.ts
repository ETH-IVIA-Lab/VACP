import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test as base, type BrowserContext, type Route } from '@playwright/test';
import type { ExampleOptions } from '@ethivia/vacp-example-shared/config';
import { repoRoot } from './paths';

const extensionCache = resolve(repoRoot, 'apps', 'e2e', 'node_modules', '.cache', 'duckdb-extensions');
const pendingExtensions = new Map<string, Promise<Buffer>>();

async function downloadExtension(route: Route, file: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await route.fetch({ timeout: 15_000 });
      if (!response.ok()) throw new Error(`${route.request().url()} answered ${response.status()}`);
      const body = await response.body();
      await mkdir(extensionCache, { recursive: true });
      // Workers share the cache, so each writes a private file and renames it into place.
      const partial = `${file}.${process.pid}.partial`;
      await writeFile(partial, body);
      await rename(partial, file);
      return body;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

/**
 * DuckDB-Wasm downloads parquet, spatial, and other extensions from extensions.duckdb.org on first
 * use. Serving them from a disk cache, with bounded retries for the first download, keeps a stalled
 * remote request from leaving a chart unrendered.
 */
async function cacheDuckDbExtensions(context: BrowserContext): Promise<void> {
  await context.route('https://extensions.duckdb.org/**', async (route) => {
    const url = new URL(route.request().url());
    const file = resolve(extensionCache, url.pathname.slice(1).replaceAll('/', '__'));
    let pending = pendingExtensions.get(file);
    if (!pending) {
      pending = readFile(file)
        .catch(() => downloadExtension(route, file))
        .finally(() => pendingExtensions.delete(file));
      pendingExtensions.set(file, pending);
    }
    const body = await pending;
    await route.fulfill({
      body,
      contentType: 'application/wasm',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
}

/**
 * Examples pace agent steps so a person can follow them. Wiring tests run unpaced; presence specs
 * restore pacing with `test.use({ exampleOptions: { paceAgentSteps: true } })`. Pages opened with
 * `browser.newPage()` keep the examples' own defaults.
 */
export const test = base.extend<{ exampleOptions: Partial<ExampleOptions> }>({
  exampleOptions: [{ paceAgentSteps: false }, { option: true }],
  context: async ({ context }, use) => {
    await cacheDuckDbExtensions(context);
    await use(context);
  },
  page: async ({ page, exampleOptions }, use) => {
    // Runs before a spec's own init scripts, which extend these options.
    await page.addInitScript((options) => {
      globalThis.__vacpExampleOptions = options;
    }, exampleOptions);
    await use(page);
  },
});

/**
 * Enable the browser's WebMCP model context for every test in the calling file. Launch options are
 * worker options, so they cannot vary between tests of one file.
 */
export function useWebMcp(): void {
  test.use({
    launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
  });
}
