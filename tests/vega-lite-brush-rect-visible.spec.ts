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
    await page.waitForFunction(() => {
      const b = (globalThis as any).__vacp;
      return b && typeof b.getCapabilities === 'function' && typeof b.getState === 'function';
    });
    await page.waitForSelector('#app canvas.marks, #app svg.marks', { timeout: 30_000 });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const playbookTab = page.locator('.vacp-debug-ui-module', { hasText: 'Playbook' });
    await expect(playbookTab).toBeVisible();
    await playbookTab.click();

    // Step 3 in the Seattle Weather playbook is "Brush Feb-Apr" (interval selection).
    await expect(page.locator('#vacp-playbook')).toBeVisible({ timeout: 30_000 });
    const brushStep = page.locator('button', { hasText: 'Brush Feb-Apr' }).first();
    await expect(brushStep).toBeVisible({ timeout: 30_000 });
    await brushStep.click();
    await page.locator('button[aria-label="Run step"]').click();

    // Regression target: ensure the interval selection is applied.
    // Avoid DOM-shape assumptions because Vega-Lite can render marks on canvas.
    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const snapshot = await (globalThis as any).__vacp.getState();
          const entries = Object.entries(snapshot?.state ?? {});
          const brushEntry = entries.find(
            ([ref, value]) =>
              String(ref).includes('/param/brush') &&
              value &&
              typeof value === 'object' &&
              (value as any).kind === 'Selection',
          );
          const dataEntry = entries.find(
            ([ref, value]) =>
              String(ref).includes('/data/main') &&
              value &&
              typeof value === 'object' &&
              (value as any).kind === 'DataHandle',
          );

          const brushValue = (brushEntry?.[1] as any)?.value;
          const hasBrushValue =
            !!brushValue &&
            typeof brushValue === 'object' &&
            Object.values(brushValue).some((v) => Array.isArray(v) && v.length === 2);

          const selectionWhere = (dataEntry?.[1] as any)?.selectionWhere;
          const hasSelectionWhere = typeof selectionWhere === 'string' && selectionWhere.length > 0;
          return hasBrushValue && hasSelectionWhere;
        });
      })
      .toBe(true);
  } finally {
    await srv.stop();
  }
});
