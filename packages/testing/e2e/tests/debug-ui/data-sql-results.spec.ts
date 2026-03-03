import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { startViteDevServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';

const artifactsDir = artifactDir('playwright-debug-ui-data-sql');

async function ensureArtifactsDir(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
}

async function openDebugUi(page: import('@playwright/test').Page): Promise<void> {
  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible({ timeout: 15_000 });
}

async function runDefaultDataSqlAndExpectResults(page: import('@playwright/test').Page): Promise<void> {
  const dataTab = page.locator('button.vacp-debug-ui-module', { hasText: 'Data' });
  await expect(dataTab).toBeVisible({ timeout: 15_000 });
  await dataTab.click();

  // The Data module may briefly show "Connecting…" while handles are being hydrated.
  const connecting = page.locator('.vacp-debug-ui-content', { hasText: 'Connecting' });
  if (await connecting.isVisible().catch(() => false)) {
    await expect(connecting).toBeHidden({ timeout: 45_000 });
  }

  const run = page.locator('button[aria-label="Run query"]');
  await expect(run).toBeVisible({ timeout: 45_000 });
  await run.click();

  const panel = page.locator('.vacp-debug-ui-panel');
  await expect(panel).toContainText('n_selected', { timeout: 20_000 });
  await expect(panel).toContainText('n_all', { timeout: 20_000 });

  const hasAnyNumber = await page.evaluate(() => {
    const panelEl = document.querySelector('.vacp-debug-ui-panel');
    const txt = panelEl?.textContent ?? '';
    return /\b\d+\b/.test(txt);
  });
  expect(hasAnyNumber).toBeTruthy();
}

const cases: Array<{ name: string; cwd: string; hash?: string }> = [
  { name: 'cars-parallel-coords', cwd: exampleDir('cars-parallel-coords') },
  { name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery'), hash: '#weather' },
  { name: 'vega-lite-gallery', cwd: exampleDir('vega-lite-gallery'), hash: '#seattle-weather' },
  { name: 'react-dashboard', cwd: exampleDir('react-dashboard') },
];

for (const c of cases) {
  test(`debug-ui: data sql shows results (${c.name})`, async ({ page }) => {
    await ensureArtifactsDir();
    const srv = await startViteDevServer({ name: c.name, cwd: c.cwd, artifactsDir });
    try {
      const targetUrl = c.hash ? `${srv.url}?vacp-debug=1${c.hash}` : `${srv.url}?vacp-debug=1`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!(globalThis as any).__vacp);

      await openDebugUi(page);
      await runDefaultDataSqlAndExpectResults(page);

      await page.screenshot({ path: resolve(artifactsDir, `${c.name}.png`), fullPage: true });
    } finally {
      await srv.stop();
    }
  });
}
