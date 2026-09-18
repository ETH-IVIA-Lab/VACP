import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { startAppServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

const artifactsDir = artifactDir('playwright-inspector-data-query-templates');

async function ensureArtifactsDir(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
}

async function openInspector(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-inspector-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-inspector-panel')).toBeVisible({ timeout: 15_000 });
}

async function openDataTab(page: Page): Promise<void> {
  await openInspector(page);
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.locator('[data-vacp-data-template-list="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-vacp-data-schema-status="1"]')).toContainText(/columns from/, { timeout: 45_000 });
}

async function runTemplate(page: Page, templateId: string, expectedHeader?: RegExp): Promise<void> {
  const template = page.locator(`[data-vacp-data-template="${templateId}"]`);
  await expect(template).toBeEnabled({ timeout: 45_000 });
  await template.click();
  await page.getByRole('button', { name: 'Run query' }).click();

  const results = page.getByRole('table', { name: 'SQL query results' });
  await expect(results).toBeVisible({ timeout: 20_000 });

  if (expectedHeader) {
    await expect(results.getByRole('columnheader', { name: expectedHeader })).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(results.getByRole('row').nth(1)).toBeVisible({ timeout: 20_000 });
  }
}

test('inspector: data templates run and exported result JSON includes resolved SQL', async ({ page }) => {
  await ensureArtifactsDir();

  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
    artifactsDir,
  });

  try {
    await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);
    await openDataTab(page);

    await runTemplate(page, 'sample');
    await runTemplate(page, 'group-categorical', /category/);
    await runTemplate(page, 'numeric-summary', /avg_value/);
    await runTemplate(page, 'temporal-range', /min_time/);

    await page.evaluate(() => {
      const w = window;

      w.__vacpDownloadProbe = [];
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        if (blob instanceof Blob) {
          void blob.text().then((text) => {
            w.__vacpDownloadProbe?.push({ filename: '', text });
          });
        }

        return createObjectURL(blob);
      };

      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function clickDownloadAnchor() {
        const last = w.__vacpDownloadProbe?.at(-1);

        if (last) last.filename = this.download;

        return click.call(this);
      };
    });
    const exportButton = page.getByRole('button', { name: 'Download result JSON' });
    await expect(exportButton).toBeVisible();
    await exportButton.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.locator('[data-vacp-data-export-status="1"]')).toContainText('Downloaded', { timeout: 5_000 });
    await page.waitForFunction(() => Boolean(window.__vacpDownloadProbe?.[0]?.text), null, { timeout: 5_000 });

    const exported = await page.evaluate(() => {
      const probe = window.__vacpDownloadProbe?.[0];

      if (!probe) throw new Error('No exported data captured');
      return JSON.parse(probe.text) as { resolvedSql?: string; columns?: Array<{ name: string }>; rows?: unknown[] };
    });

    expect(exported.resolvedSql).toContain('vacp_handle');
    expect(exported.columns?.some((column) => column.name === 'min_time')).toBe(true);
    expect(Array.isArray(exported.rows)).toBe(true);

    await page.screenshot({ path: resolve(artifactsDir, 'data-query-templates.png'), fullPage: true });
  } finally {
    await srv.stop();
  }
});

test('inspector: data templates default to the primary handle when an example has auxiliary handles', async ({
  page,
}) => {
  await ensureArtifactsDir();

  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
    artifactsDir,
  });

  try {
    await page.goto(`${srv.url}#wnba-shots`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);
    await openDataTab(page);

    const handleSelect = page.locator('#vacp-handle');
    await expect(handleSelect).toHaveValue(/\/data\/main$/);

    await runTemplate(page, 'group-categorical', /category/);
    await expect(page.locator('[data-vacp-data-schema-status="1"]')).toContainText('columns from vacp.data_schema');
    await expect(page.locator('[data-vacp-action-result="1"]')).toHaveCount(0);
    await expect(page.getByText(/Binder Error/i)).toHaveCount(0);

    await page.screenshot({ path: resolve(artifactsDir, 'data-query-templates-primary-handle.png'), fullPage: true });
  } finally {
    await srv.stop();
  }
});
