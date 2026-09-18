import type { VgplotPlotLike } from '@vacp/adapter-vgplot';

import { expect, test } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

type Normalized = null | undefined | number | string | boolean | Normalized[] | { [k: string]: Normalized };

function normalizeValue(value: any): Normalized {
  if (value == null) return value;

  if (value instanceof Date) return value.getTime();

  if (Array.isArray(value)) return value.map((v) => normalizeValue(v));

  if (typeof value === 'object') {
    // Keep only primitive fields so assertion diffs stay readable.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .map(([k, v]) => [k, normalizeValue(v)]),
    );
  }

  return value;
}

test('vgplot: apply_state preserves subsequent human brushing (Seattle Weather)', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__vacp);

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
        const v = 'value' in el ? el.value : undefined;

        return (
          v &&
          typeof v === 'object' &&
          'marks' in v &&
          'interactors' in v &&
          Array.isArray(v.marks) &&
          Array.isArray(v.interactors)
        );
      });

      const plot0 = (hosts[0] as (Element & { value: VgplotPlotLike }) | undefined)?.value;
      const i0 = plot0?.interactors?.[0];
      const interactorValue = i0?.value ?? null;
      const selectionValue = i0?.selection?.value ?? null;
      const vacp = globalThis.__vacp;
      const snap = await vacp.getState();
      globalThis.__savedState = typeof structuredClone === 'function' ? structuredClone(snap.state) : snap.state;

      return {
        interactorValue,
        selectionValue,
      };
    });

    expect(first).toBeTruthy();

    // Apply the current state snapshot back into the app, then brush again.
    const applyRes = await page.evaluate(async () => {
      const vacp = globalThis.__vacp;
      const state = globalThis.__savedState;

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
        const v = 'value' in el ? el.value : undefined;

        return (
          v &&
          typeof v === 'object' &&
          'marks' in v &&
          'interactors' in v &&
          Array.isArray(v.marks) &&
          Array.isArray(v.interactors)
        );
      });

      const plot0 = (hosts[0] as (Element & { value: VgplotPlotLike }) | undefined)?.value;
      const i0 = plot0?.interactors?.[0];

      return {
        interactorValue: i0?.value ?? null,
        selectionValue: i0?.selection?.value ?? null,
      };
    });

    expect(second).toBeTruthy();

    if (!first || !second) throw new Error('Missing plot state');
    const firstN = normalizeValue(first.interactorValue);
    const secondN = normalizeValue(second.interactorValue);
    expect(secondN).not.toEqual(firstN);

    expect(normalizeValue(second.selectionValue)).toEqual(secondN);
  } finally {
    await srv.stop();
  }
});
