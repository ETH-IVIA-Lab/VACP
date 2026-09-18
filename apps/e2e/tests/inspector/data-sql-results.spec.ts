import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { startAppServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

const artifactsDir = artifactDir('playwright-inspector-data-sql');

async function ensureArtifactsDir(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
}

async function openInspector(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-inspector-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-inspector-panel')).toBeVisible({ timeout: 15_000 });
}

async function runDefaultDataSqlAndExpectResults(page: Page): Promise<void> {
  const dataTab = page.getByRole('tab', { name: 'Data' });
  await expect(dataTab).toBeVisible({ timeout: 15_000 });
  await dataTab.click();

  // The Data module may briefly show "Connecting..." while handles are hydrated.
  const connecting = page.locator('.vacp-inspector-content', { hasText: 'Connecting' });

  if (await connecting.isVisible().catch(() => false)) {
    await expect(connecting).toBeHidden({ timeout: 45_000 });
  }

  const run = page.locator('button[aria-label="Run query"]');
  await expect(run).toBeVisible({ timeout: 45_000 });
  await run.click();

  const results = page.getByRole('table', { name: 'SQL query results' });
  await expect(results).toBeVisible({ timeout: 20_000 });
  await expect(results.getByRole('columnheader', { name: /n_selected/ })).toBeVisible();
  await expect(results.getByRole('columnheader', { name: /n_all/ })).toBeVisible();

  const resultRow = await results.evaluate((table) => {
    const headers = [...table.querySelectorAll<HTMLElement>('[role="columnheader"]')].map(
      (header) => header.textContent ?? '',
    );

    const selectedIndex = headers.findIndex((header) => header.includes('n_selected'));
    const allIndex = headers.findIndex((header) => header.includes('n_all'));

    if (selectedIndex === -1 || allIndex === -1) return null;

    for (const row of table.querySelectorAll<HTMLElement>('[role="row"]')) {
      const cells = [...row.querySelectorAll<HTMLElement>('[role="cell"], [role="rowheader"]')];
      const nSelected = Number(cells[selectedIndex]?.textContent?.trim());
      const nAll = Number(cells[allIndex]?.textContent?.trim());

      if (Number.isInteger(nSelected) && Number.isInteger(nAll)) return { nSelected, nAll };
    }

    return null;
  });

  expect(resultRow).toEqual(
    expect.objectContaining({
      nSelected: expect.any(Number),
      nAll: expect.any(Number),
    }),
  );
  expect(resultRow!.nSelected).toBeGreaterThanOrEqual(0);
  expect(resultRow!.nAll).toBeGreaterThan(0);
  expect(resultRow!.nSelected).toBeLessThanOrEqual(resultRow!.nAll);
}

async function selectReactDashboardDataset(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Iris' }).click();
  await expect(page.getByText('Showing 150 rows. Click')).toBeVisible({ timeout: 15_000 });
  await waitForVacpBridge(page);
}

const cases: Array<{ name: string; cwd: string; hash?: string; prepare?: (page: Page) => Promise<void> }> = [
  { name: 'cars-parallel-coords', cwd: exampleDir('cars-parallel-coords') },
  { name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery'), hash: '#weather' },
  { name: 'vega-lite-gallery', cwd: exampleDir('vega-lite-gallery'), hash: '#seattle-weather' },
  { name: 'react-dashboard', cwd: exampleDir('react-dashboard'), prepare: selectReactDashboardDataset },
];

for (const c of cases) {
  test(`inspector: data sql shows results (${c.name})`, async ({ page }) => {
    await ensureArtifactsDir();
    const srv = await startAppServer({ name: c.name, cwd: c.cwd, artifactsDir });

    try {
      const targetUrl = c.hash ? `${srv.url}${c.hash}` : `${srv.url}`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await waitForVacpBridge(page);
      await c.prepare?.(page);

      await openInspector(page);
      await runDefaultDataSqlAndExpectResults(page);

      await page.screenshot({ path: resolve(artifactsDir, `${c.name}.png`), fullPage: true });
    } finally {
      await srv.stop();
    }
  });
}
