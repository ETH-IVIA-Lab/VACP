import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

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
    cwd: resolve(examplesDir, 'cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    // Mermaid graph should default to left-to-right.
    await expect(page.locator('[data-vacp-graph="1"]')).toHaveAttribute('data-vacp-direction', 'LR');
    await expect(page.locator('.vacp-debug-ui-diagram svg')).toBeVisible({ timeout: 15_000 });

    const dimensionOrder = async () =>
      await page.evaluate(async () => {
        const b = (globalThis as any).__vacp;
        const snap = await b.getState();
        const st = snap && typeof snap === 'object' ? (snap as any).state : null;
        const param = st
          ? (Object.values(st).find(
              (v: any) => v && typeof v === 'object' && v.kind === 'Param' && Array.isArray((v as any).value),
            ) as any)
          : null;
        const order = Array.isArray(param?.value) ? param.value : [];
        return order.map((x: any) => String(x));
      });

    // Create a few history entries with different param states.
    const orders = await page.evaluate(async () => {
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

      return { orderA, orderB };
    });
    const { orderA, orderB } = orders;
    expect(await dimensionOrder()).toEqual(orderB);

    const historyTab = page.locator('.vacp-debug-ui-module', { hasText: 'History' });
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
      const order = await dimensionOrder();
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
    await expect.poll(async () => await dimensionOrder()).toEqual(orderA);

    for (let i = 0; i < 6; i++) {
      const order = await dimensionOrder();
      if (order.join('|||') === orderB.join('|||')) break;
      await page.locator('button[aria-label="Redo"]').click();
      await page.waitForTimeout(50);
    }
    await expect.poll(async () => await dimensionOrder()).toEqual(orderB);

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
