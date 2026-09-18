import { expect, test } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import {
  inspectorRuntimeState,
  dimensionOrder,
  dispatchDimensionOrderPair,
  waitForRuntimeMode,
  waitForVacpBridge,
} from './helpers';

test('inspector: history undo/redo updates time travel cursor', async ({ page }) => {
  const srv = await startAppServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const pill = page.locator('button.vacp-inspector-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-inspector-panel')).toBeVisible();

    await expect(page.locator('[data-vacp-graph="1"]')).toHaveAttribute('data-vacp-direction', 'LR');
    await expect(page.locator('[data-vacp-graph-flow="1"] [data-vacp-flow-node-kind]').first()).toBeVisible({
      timeout: 15_000,
    });

    const orders = await dispatchDimensionOrderPair(page);
    const { orderA, orderB } = orders;
    expect(await dimensionOrder(page)).toEqual(orderB);

    const historyTab = page.getByRole('tab', { name: 'History' });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    await expect.poll(async () => (await inspectorRuntimeState(page)).historyLength).toBeGreaterThanOrEqual(3);

    // Undo can traverse through multiple history entry kinds; keep clicking until
    // we reach the previous param state.
    for (let i = 0; i < 6; i++) {
      const order = await dimensionOrder(page);

      if (order.join('|||') === orderA.join('|||')) break;
      await page.locator('button[aria-label="Undo"]').click();
      await waitForRuntimeMode(page, 'inspect');
    }

    await expect.poll(async () => (await inspectorRuntimeState(page)).mode).toBe('inspect');
    await expect.poll(async () => await dimensionOrder(page)).toEqual(orderA);

    for (let i = 0; i < 6; i++) {
      const order = await dimensionOrder(page);

      if (order.join('|||') === orderB.join('|||')) break;
      await page.locator('button[aria-label="Redo"]').click();
      await page.waitForTimeout(50);
    }

    await expect.poll(async () => await dimensionOrder(page)).toEqual(orderB);

    await waitForRuntimeMode(page, 'inspect');
    const snapshotEntry = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]').first();
    await expect(snapshotEntry).toBeVisible();
    const targetIdxText = await snapshotEntry.getAttribute('data-index');
    const targetIdx = Number(targetIdxText);
    expect(Number.isFinite(targetIdx)).toBeTruthy();
    await snapshotEntry.click();
    await expect
      .poll(async () => await inspectorRuntimeState(page))
      .toMatchObject({ mode: 'inspect', cursor: targetIdx });
  } finally {
    await srv.stop();
  }
});
