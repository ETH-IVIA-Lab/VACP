import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

type Normalized = null | undefined | number | string | boolean | Normalized[] | { [k: string]: Normalized };

function normalizeValue(value: any): Normalized {
  if (value == null) return value;
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map((v) => normalizeValue(v));
  if (typeof value === 'object') {
    // Make debugging failures readable: only keep primitive-ish fields.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .map(([k, v]) => [k, normalizeValue(v)]),
    );
  }
  return value;
}

test('mosaic: apply_state does not break subsequent human brushing (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const overlay = page.locator('#app svg').first().locator('rect.overlay').first();
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const brush = async (fromFrac: number, toFrac: number) => {
      const y = box.y + box.height * 0.5;
      const x0 = box.x + box.width * fromFrac;
      const x1 = box.x + box.width * toFrac;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      await page.mouse.move(x1, y);
      await page.mouse.up();
    };

    // First human brush, with *no* legend/toggle selection set.
    await brush(0.15, 0.45);
    await page.waitForFunction(() => {
      const r = document
        .querySelector('#app')
        ?.querySelector('svg')
        ?.querySelector('rect.selection') as SVGRectElement | null;
      if (!r) return false;
      const b = r.getBBox();
      return b.width > 2 && b.height > 2;
    });

    const first = await page.evaluate(async () => {
      const root = document.querySelector('#app');
      if (!root) return null;
      const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
      const hosts = all.filter((el) => {
        const v = (el as any).value;
        return v && typeof v === 'object' && Array.isArray(v.marks) && Array.isArray(v.interactors);
      });
      const plot0 = (hosts[0] as any)?.value;
      const i0 = plot0?.interactors?.[0];
      const interactorValue = i0?.value ?? null;
      const selectionValue = i0?.selection?.value ?? null;
      const vacp = (globalThis as any).__vacp;
      const snap = await vacp.getState();
      (globalThis as any).__savedState =
        typeof structuredClone === 'function' ? structuredClone(snap.state) : snap.state;
      return {
        interactorValue,
        selectionValue,
      };
    });
    expect(first).toBeTruthy();

    // Apply the current state snapshot back into the app (no-op-ish), then brush again.
    const applyRes = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const state = (globalThis as any).__savedState;
      return await vacp.execute({ callId: crypto.randomUUID(), name: 'vacp.apply_state', params: { state } });
    });
    expect(applyRes?.ok).toBeTruthy();

    await brush(0.6, 0.9);

    // The interactor's value and its selection's active value must always stay in sync.
    const second = await page.evaluate(() => {
      const root = document.querySelector('#app');
      if (!root) return null;
      const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
      const hosts = all.filter((el) => {
        const v = (el as any).value;
        return v && typeof v === 'object' && Array.isArray(v.marks) && Array.isArray(v.interactors);
      });
      const plot0 = (hosts[0] as any)?.value;
      const i0 = plot0?.interactors?.[0];
      return {
        interactorValue: i0?.value ?? null,
        selectionValue: i0?.selection?.value ?? null,
      };
    });
    expect(second).toBeTruthy();

    const firstN = normalizeValue((first as any).interactorValue);
    const secondN = normalizeValue((second as any).interactorValue);
    expect(secondN).not.toEqual(firstN);

    expect(normalizeValue((second as any).selectionValue)).toEqual(secondN);
  } finally {
    await srv.stop();
  }
});
