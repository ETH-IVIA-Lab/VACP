import { expect } from '@playwright/test';
import { test } from '../helpers/test';

import { gotoApp } from '../helpers/servers';

test('window.__vacp.getState returns a full read with a token, deltas since a token, and a full read for a stale one', async ({
  page,
}) => {
  await gotoApp(page, 'cars-parallel-coords');

  const result = await page.evaluate(async () => {
    const b = globalThis.__vacp;

    const full = await b.getState();
    if (full.mode !== 'full') throw new Error('A read without since is a full read');

    const state = full.snapshot.state;

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

    const delta = await b.getState({ since: full.token });
    const stale = await b.getState({ since: 'st_missing' });
    const noop = await b.getState({ since: delta.token });

    return { full, delta, stale, noop, paramRef };
  });

  expect(result.full.mode).toBe('full');
  expect(typeof result.full.token).toBe('string');
  expect(result.delta.mode).toBe('delta');
  expect(result.delta.baseToken).toBe(result.full.token);
  expect(result.delta.delta.changed).toHaveProperty(result.paramRef);
  expect(result.stale.mode).toBe('full');
  expect(result.noop.mode).toBe('delta');
  expect(result.noop.delta.changed ?? {}).toEqual({});
  expect(result.noop.delta.removed).toEqual([]);
});
