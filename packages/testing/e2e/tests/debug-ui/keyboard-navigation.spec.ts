import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

test('debug-ui: keyboard navigation (tabs + roving focus)', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    // Create a few history entries with state.
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

      const orderA = [...base];
      [orderA[0], orderA[1]] = [orderA[1], orderA[0]];

      const orderB = [...orderA];
      if (orderB.length >= 3) [orderB[0], orderB[1], orderB[2]] = [orderB[2], orderB[0], orderB[1]];

      await b.dispatch(
        { callId: crypto.randomUUID(), name: 'parallel_coords.set_dimension_order', params: { order: orderA } },
        { source: 'debug', message: 'order A' },
      );
      await b.dispatch(
        { callId: crypto.randomUUID(), name: 'parallel_coords.set_dimension_order', params: { order: orderB } },
        { source: 'debug', message: 'order B' },
      );
    });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const graphTab = page.locator('.vacp-debug-ui-module', { hasText: 'Graph' });
    const dataTab = page.locator('.vacp-debug-ui-module', { hasText: 'Data' });
    await expect(graphTab).toBeVisible();

    // Ensure we can move focus with arrows (vertical tabs) and activate with Enter.
    await graphTab.focus();
    await page.keyboard.press('ArrowDown');
    await expect(dataTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dataTab).toHaveAttribute('data-state', 'active');

    // History list should support roving focus via ArrowUp/ArrowDown.
    const historyTab = page.locator('.vacp-debug-ui-module', { hasText: 'History' });
    await historyTab.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-vacp-row="history-entry"]').length >= 2);

    const firstRow = page.locator('[data-vacp-row="history-entry"]').first();
    const secondRow = page.locator('[data-vacp-row="history-entry"]').nth(1);
    await firstRow.focus();
    await expect(firstRow).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(secondRow).toBeFocused();
  } finally {
    await srv.stop();
  }
});
