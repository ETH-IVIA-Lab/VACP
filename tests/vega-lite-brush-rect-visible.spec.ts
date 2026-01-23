import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('vega-lite: interval brush playbook renders brush rectangle (sets brush_x)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vega-lite-gallery', cwd: resolve(examplesDir, 'vega-lite-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#seattle-weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);
    await page.waitForSelector('#app canvas', { timeout: 30_000 });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const playbookTab = page.locator('.vacp-debug-ui-module', { hasText: 'Playbook' });
    await expect(playbookTab).toBeVisible();
    await playbookTab.click();

    // Step 3 in the Seattle Weather playbook is "Brush Feb-Apr" (interval selection).
    const brushStep = page.locator('button', { hasText: '3. Brush Feb-Apr' }).first();
    await expect(brushStep).toBeVisible({ timeout: 30_000 });
    await brushStep.click();
    await page.locator('button[aria-label="Run step"]').click();

    // Regression target: ensure the interval brush pixel extents are set so the
    // brush rectangle becomes visible (Vega-Lite uses `brush_x`/`brush_y` signals).
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const view = (globalThis as any).__vegaView;
        if (!view || typeof view.getState !== 'function') return null;
        const st = view.getState();
        const ctx0 = st?.subcontext?.['0'];
        const brushX = ctx0?.signals?.brush_x;
        if (!Array.isArray(brushX) || brushX.length !== 2) return null;
        if (!brushX.every((v: any) => typeof v === 'number' && Number.isFinite(v))) return null;
        const store = typeof view.data === 'function' ? view.data('brush_store') : null;
        const unit = Array.isArray(store) && store[0] && typeof store[0] === 'object' ? (store[0] as any).unit : null;
        return { brushX, unit };
      });
    }).toEqual({ brushX: [expect.any(Number), expect.any(Number)], unit: 'concat_0' });
  } finally {
    await srv.stop();
  }
});
