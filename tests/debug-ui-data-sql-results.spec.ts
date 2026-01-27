import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

const artifactsDir = resolve(vacpRoot, '.artifacts', 'playwright-debug-ui-data-sql');

async function ensureArtifactsDir(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
}

async function openDebugUi(page: import('@playwright/test').Page): Promise<void> {
  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('.vacp-debug-ui-meta')).toContainText('mode=', { timeout: 15_000 });
}

async function runDefaultDataSqlAndExpectResults(page: import('@playwright/test').Page): Promise<void> {
  const dataTab = page.locator('button.vacp-debug-ui-module', { hasText: 'Data' });
  await expect(dataTab).toBeVisible({ timeout: 15_000 });
  await dataTab.click();

  const run = page.locator('button[aria-label="Run query"]');
  await expect(run).toBeVisible({ timeout: 15_000 });
  await run.click();

  const panel = page.locator('.vacp-debug-ui-panel');
  await expect(panel).toContainText('n_selected', { timeout: 20_000 });
  await expect(panel).toContainText('n_all', { timeout: 20_000 });

  const hasAnyNumber = await page.evaluate(() => {
    const panelEl = document.querySelector('.vacp-debug-ui-panel');
    const txt = panelEl?.innerText ?? '';
    return /\b\d+\b/.test(txt);
  });
  expect(hasAnyNumber).toBeTruthy();
}

const cases: Array<{ name: string; cwd: string }> = [
  { name: 'cars-parallel-coords', cwd: resolve(examplesDir, 'cars-parallel-coords') },
  { name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') },
  { name: 'vega-lite-gallery', cwd: resolve(examplesDir, 'vega-lite-gallery') },
  { name: 'react-dashboard', cwd: resolve(examplesDir, 'react-dashboard') },
];

for (const c of cases) {
  test(`debug-ui: data sql shows results (${c.name})`, async ({ page }) => {
    await ensureArtifactsDir();
    const srv = await startViteDevServer({ name: c.name, cwd: c.cwd, artifactsDir });
    try {
      await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!(globalThis as any).__vacp);

      await openDebugUi(page);
      await runDefaultDataSqlAndExpectResults(page);

      await page.screenshot({ path: resolve(artifactsDir, `${c.name}.png`), fullPage: true });
    } finally {
      await srv.stop();
    }
  });
}

