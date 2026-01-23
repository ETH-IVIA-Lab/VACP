import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('mosaic: set_interval_1d triggers downstream crossfilters (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    // Capture a stable-ish fingerprint of the *second* plot (the bar chart) before the action.
    const before = await page.evaluate(() => {
      const root = document.querySelector('#app');
      if (!root) return null;
      const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
      const hosts = all.filter((el) => {
        const v = (el as any).value;
        return v && typeof v === 'object' && Array.isArray(v.marks) && Array.isArray(v.interactors);
      });
      const host = hosts[1] as Element | undefined;
      const svg = host?.querySelector('svg');
      return svg?.outerHTML ?? null;
    });
    expect(before).toBeTruthy();

    // Programmatic brush (June-Aug) on the scatter plot should change the bottom bar chart.
    const callId = crypto.randomUUID();
    const res = await page.evaluate(
      async ({ callId }) => {
        const vacp = (globalThis as any).__vacp;
        return await vacp.execute({
          callId,
          name: 'mosaic.set_interval_1d',
          params: {
            plotId: 'plot-0',
            interactorId: '0',
            min: 1338508800000,
            max: 1346457600000,
          },
        });
      },
      { callId },
    );
    expect(res?.ok).toBeTruthy();

    // Ensure the brush rect renders (visual parity with human brushing).
    await page.waitForFunction(() => {
      const app = document.querySelector('#app');
      const svg = app?.querySelector('svg');
      const r = svg?.querySelector('rect.selection') as SVGRectElement | null;
      if (!r) return false;
      const b = r.getBBox();
      return b.width > 1 && b.height > 1;
    });

    await page.waitForFunction(
      ({ before }) => {
        const root = document.querySelector('#app');
        if (!root) return false;
        const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
        const hosts = all.filter((el) => {
          const v = (el as any).value;
          return v && typeof v === 'object' && Array.isArray(v.marks) && Array.isArray(v.interactors);
        });
        const host = hosts[1] as Element | undefined;
        const svg = host?.querySelector('svg');
        const now = svg?.outerHTML ?? '';
        return !!before && now.length > 0 && now !== before;
      },
      { before },
      { timeout: 15_000 },
    );

    // Capture a post-action snapshot (includes the interval selection in domain units) and then
    // prove vacp.apply_state can restore it after changing the interval again.
    const restoreResult = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const snap = await vacp.getState();
      const savedState = typeof structuredClone === 'function' ? structuredClone(snap.state) : snap.state;
      const sel = document
        .querySelector('#app')
        ?.querySelector('svg')
        ?.querySelector('rect.selection') as SVGRectElement | null;
      const aBox = sel?.getBBox?.() ?? null;
      const a = aBox ? { x: aBox.x, width: aBox.width, height: aBox.height } : null;

      // Change to a different interval (Oct-Nov) so we can confirm restore.
      await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'mosaic.set_interval_1d',
        params: { plotId: 'plot-0', interactorId: '0', min: 1349049600000, max: 1351728000000 },
      });
      const selB = document
        .querySelector('#app')
        ?.querySelector('svg')
        ?.querySelector('rect.selection') as SVGRectElement | null;
      const bBox = selB?.getBBox?.() ?? null;
      const b = bBox ? { x: bBox.x, width: bBox.width, height: bBox.height } : null;

      const res = await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.apply_state',
        params: { state: savedState },
      });
      const selAfter = document
        .querySelector('#app')
        ?.querySelector('svg')
        ?.querySelector('rect.selection') as SVGRectElement | null;
      const afterBox = selAfter?.getBBox?.() ?? null;
      const after = afterBox ? { x: afterBox.x, width: afterBox.width, height: afterBox.height } : null;
      return {
        ok: Boolean(res?.ok),
        a,
        b,
        after,
        applied: res?.result?.applied ?? 0,
        errors: res?.result?.errors ?? [],
      };
    });
    expect(restoreResult.ok).toBeTruthy();
    expect(restoreResult.applied).toBeGreaterThanOrEqual(1);
    expect(restoreResult.a).toBeTruthy();
    expect(restoreResult.b).toBeTruthy();
    expect(restoreResult.after).toBeTruthy();
    if (restoreResult.a && restoreResult.b && restoreResult.after) {
      expect(restoreResult.b.x).not.toBe(restoreResult.a.x);
      expect(restoreResult.after.x).toBe(restoreResult.a.x);
    }
  } finally {
    await srv.stop();
  }
});
