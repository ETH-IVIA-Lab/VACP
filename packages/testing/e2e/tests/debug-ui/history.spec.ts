import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { dimensionOrder, dispatchDimensionOrderPair, waitForVacpBridge } from './helpers';

function parseMeta(text: string): { mode: string; cursor: number; history: number } {
  const mode = text.match(/mode=(\w+)/)?.[1];
  const cursor = text.match(/cursor=(-?\d+)/)?.[1];
  const history = text.match(/history=(\d+)/)?.[1];
  if (!mode || !cursor || !history) throw new Error(`Could not parse debug-ui meta: ${text}`);
  return { mode, cursor: Number(cursor), history: Number(history) };
}

test('debug-ui: history undo/redo updates time travel cursor', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    // Mermaid graph should default to left-to-right.
    await expect(page.locator('[data-vacp-graph="1"]')).toHaveAttribute('data-vacp-direction', 'LR');
    await expect(page.locator('.vacp-debug-ui-diagram svg')).toBeVisible({ timeout: 15_000 });

    const orders = await dispatchDimensionOrderPair(page);
    const { orderA, orderB } = orders;
    expect(await dimensionOrder(page)).toEqual(orderB);

    const historyTab = page.getByRole('tab', { name: 'History' });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-meta')?.textContent ?? '';
      const m = t.match(/history=(\d+)/);
      return m && Number(m[1]) >= 3;
    });

    const beforeMeta = await page.locator('.vacp-debug-ui-meta').innerText();
    const before = parseMeta(beforeMeta);
    expect(before.history).toBeGreaterThanOrEqual(3);

    // Undo can traverse through multiple history entry kinds; keep clicking until
    // we reach the previous param state.
    for (let i = 0; i < 6; i++) {
      const order = await dimensionOrder(page);
      if (order.join('|||') === orderA.join('|||')) break;
      await page.locator('button[aria-label="Undo"]').click();
      await page.waitForFunction(() => {
        const t = document.querySelector('.vacp-debug-ui-meta')?.textContent ?? '';
        return /mode=inspect/.test(t);
      });
    }

    const afterUndoMeta = await page.locator('.vacp-debug-ui-meta').innerText();
    const afterUndo = parseMeta(afterUndoMeta);
    expect(afterUndo.mode).toBe('inspect');
    await expect.poll(async () => await dimensionOrder(page)).toEqual(orderA);

    for (let i = 0; i < 6; i++) {
      const order = await dimensionOrder(page);
      if (order.join('|||') === orderB.join('|||')) break;
      await page.locator('button[aria-label="Redo"]').click();
      await page.waitForTimeout(50);
    }
    await expect.poll(async () => await dimensionOrder(page)).toEqual(orderB);

    // Time travel by clicking a snapshot entry while in inspect mode.
    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-meta')?.textContent ?? '';
      return /mode=inspect/.test(t);
    });
    const snapshotEntry = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]').first();
    await expect(snapshotEntry).toBeVisible();
    const targetIdxText = await snapshotEntry.getAttribute('data-index');
    const targetIdx = Number(targetIdxText);
    expect(Number.isFinite(targetIdx)).toBeTruthy();
    await snapshotEntry.click();
    await page.waitForFunction(
      ({ expectedCursor }) => {
        const t = document.querySelector('.vacp-debug-ui-meta')?.textContent ?? '';
        const mode = t.match(/mode=(\w+)/)?.[1];
        const cursor = t.match(/cursor=(-?\d+)/)?.[1];
        return mode === 'inspect' && Number(cursor) === expectedCursor;
      },
      { expectedCursor: targetIdx },
    );
  } finally {
    await srv.stop();
  }
});
