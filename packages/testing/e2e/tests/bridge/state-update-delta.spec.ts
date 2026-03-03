import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

test('window.__vacp.getState(request) supports full/delta and stale-token fallback', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });

  try {
    await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const result = await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;

      const full = await b.getState({ mode: 'full' });
      const fullDefault = await b.getState();

      const state = fullDefault?.state ?? {};
      const paramRef = Object.keys(state).find((ref) => {
        const v = state[ref];
        return v && typeof v === 'object' && (v as any).kind === 'Param' && Array.isArray((v as any).value);
      });
      if (!paramRef) throw new Error('Missing sortable Param state for test');

      const order = [...((state[paramRef] as any).value as unknown[])].map((x) => String(x));
      if (order.length < 2) throw new Error('Need at least two dimensions to reorder');
      const swapped = [...order];
      [swapped[0], swapped[1]] = [swapped[1], swapped[0]];

      await b.execute({
        callId: crypto.randomUUID(),
        name: 'parallel_coords.set_dimension_order',
        params: { order: swapped },
      });

      const delta = await b.getState({ mode: 'delta', since: full.token });
      const stale = await b.getState({ mode: 'delta', since: 'st_missing' });
      const noop = await b.getState({ mode: 'delta', since: delta.token });

      return { full, delta, stale, noop, paramRef };
    });

    expect(result.full.mode).toBe('full');
    expect(typeof result.full.token).toBe('string');
    expect(result.delta.mode).toBe('delta');
    expect(result.delta.baseToken).toBe(result.full.token);
    expect(result.delta.delta).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(result.delta.delta.changed ?? {}, result.paramRef)).toBeTruthy();
    expect(result.stale.mode).toBe('full');
    expect(result.noop.mode).toBe('delta');
    expect(Object.keys(result.noop.delta.changed ?? {})).toHaveLength(0);
    expect(Array.isArray(result.noop.delta.removed)).toBeTruthy();
  } finally {
    await srv.stop();
  }
});
