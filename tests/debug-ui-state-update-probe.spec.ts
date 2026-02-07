import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('debug-ui: state update probe surfaces full and delta summaries', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: resolve(examplesDir, 'cars-parallel-coords'),
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const jsonTab = page.locator('.vacp-debug-ui-module', { hasText: 'JSON' });
    await expect(jsonTab).toBeVisible();
    await jsonTab.click();

    const panel = page.locator('[data-vacp-state-update="panel"]');
    await expect(panel).toBeVisible();
    await panel.locator('summary', { hasText: 'State update probe' }).click();

    const seedSince = page.locator('button[aria-label="Seed since from full"]');
    await expect(seedSince).toBeVisible();
    await seedSince.click();

    const sinceInput = page.locator('[data-vacp-state-update="since"]');
    await expect.poll(async () => await sinceInput.inputValue()).toMatch(/^st_[a-f0-9]+$/);
    await expect(page.locator('[data-vacp-state-update="summary"]')).toContainText(/mode[:=]\s*full/i);

    await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;
      if (!b || typeof b.dispatch !== 'function') throw new Error('Missing bridge.dispatch');

      const snap = await b.getState();
      const st = snap && typeof snap === 'object' ? (snap as any).state : null;
      const param = st
        ? (Object.values(st).find(
            (v: any) => v && typeof v === 'object' && v.kind === 'Param' && Array.isArray((v as any).value),
          ) as any)
        : null;
      const base = Array.isArray(param?.value) ? param.value.map((x: any) => String(x)) : [];
      if (base.length < 2) throw new Error('Expected dimension order with >= 2 entries');

      const swapped = [...base];
      [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
      await b.dispatch(
        { callId: crypto.randomUUID(), name: 'parallel_coords.set_dimension_order', params: { order: swapped } },
        { source: 'debug', message: 'state update probe delta check' },
      );
    });

    await page.selectOption('[data-vacp-state-update="mode"]', 'delta');
    await page.locator('button[aria-label="Request update"]').click();

    const summary = page.locator('[data-vacp-state-update="summary"]');
    await expect(summary).toContainText(/mode[:=]\s*delta/i);
    const text = await summary.innerText();
    const changed = Number(text.match(/changed[:=]\s*(\d+)/i)?.[1] ?? '0');
    expect(changed).toBeGreaterThan(0);
  } finally {
    await srv.stop();
  }
});
