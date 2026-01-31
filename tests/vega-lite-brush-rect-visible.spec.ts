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
    await page.waitForSelector('#app svg.marks .mark-group.role-frame.root', { timeout: 30_000 });

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

    // Regression target: ensure the interval brush rectangle becomes visible.
    // We intentionally do not rely on `window.__vegaView` (it is not exposed).
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const path = document.querySelector('#app svg.marks g.brush_brush path');
          if (!(path instanceof SVGPathElement)) return false;
          const rect = path.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      })
      .toBe(true);
  } finally {
    await srv.stop();
  }
});
