import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');
const artifactsDir = resolve(vacpRoot, '.artifacts', 'playwright-vega-lite-graph');

async function ensureArtifactsDir(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
}

async function openDebugUi(page: import('@playwright/test').Page): Promise<void> {
  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible({ timeout: 15_000 });
}

async function waitForCapabilityRefContains(
  page: import('@playwright/test').Page,
  needle: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    const ok = await page.evaluate(async (n) => {
      const caps = await (globalThis as any).__vacp.getCapabilities();
      const nodes = caps?.graph?.nodes ?? [];
      return nodes.some((x: any) => typeof x?.ref === 'string' && String(x.ref).includes(n));
    }, needle);
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for capability ref containing: ${needle}`);
    await page.waitForTimeout(150);
  }
}

test('vega-lite: debug-ui graph visually renders mark/channel/field nodes for all gallery specs', async ({ page }) => {
  await ensureArtifactsDir();
  const srv = await startViteDevServer({
    name: 'vega-lite-gallery',
    cwd: resolve(examplesDir, 'vega-lite-gallery'),
    artifactsDir,
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    await openDebugUi(page);
    const graphTab = page.locator('button.vacp-debug-ui-module', { hasText: 'Graph' });
    await expect(graphTab).toBeVisible({ timeout: 15_000 });
    await graphTab.click();

    const specIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('#spec option')).map((o) => o.value),
    );
    expect(specIds.length).toBeGreaterThanOrEqual(3);

    for (const specId of specIds) {
      await page.evaluate((id) => {
        const sel = document.querySelector<HTMLSelectElement>('#spec');
        if (!sel) throw new Error('Missing #spec');
        sel.value = id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, specId);

      await page.waitForSelector('#app canvas.marks, #app svg.marks', { timeout: 30_000 });
      await waitForCapabilityRefContains(page, `/vega-lite/${specId}/${specId}`);
      await expect(page.locator('.vacp-debug-ui-diagram svg')).toBeVisible({ timeout: 15_000 });

      await page.waitForFunction(() => {
        const svg = document.querySelector('.vacp-debug-ui-diagram svg');
        if (!svg) return false;
        const text = svg.textContent ?? '';
        if (!text.includes('Mark') || !text.includes('EncodingChannel') || !text.includes('EncodedField')) return false;
        return !text.includes('%2F') && !text.includes('%5B') && !text.includes('%5D');
      });

      await page.locator('#vacp-debug-ui-panel').screenshot({
        path: resolve(artifactsDir, `vega-lite-${specId}-graph.png`),
      });
    }
  } finally {
    await srv.stop();
  }
});
