import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!globalThis.__vacp &&
      typeof globalThis.__vacp.getState === 'function' &&
      typeof globalThis.__vacp.execute === 'function',
  );
}

async function firstStateRef(page: Page, kind: string): Promise<string> {
  const ref = await page.evaluate(async (kind) => {
    const vacp = globalThis.__vacp;
    const snap = await vacp.getState();

    return Object.entries(snap.state).find(([, value]) => (value as any)?.kind === kind)?.[0] ?? null;
  }, kind);

  if (!ref) throw new Error(`Missing state ref for ${kind}`);

  return ref;
}

test('vgplot: clear_input keeps menu snapshots readable', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#aeromagnetic-survey`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const inputRef = await firstStateRef(page, 'Widget');

    const result = await page.evaluate(
      async (ref) =>
        await globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.clear_input',
          params: { ref },
        }),
      inputRef,
    );

    expect(result?.ok).toBe(true);

    const snapshot = await page.evaluate(async () => await globalThis.__vacp.getState());
    expect(snapshot?.state?.[inputRef]?.kind).toBe('Widget');

    const options = await page.evaluate(
      async (ref) =>
        await globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vacp.widget_options',
          params: { ref, limit: 5 },
        }),
      inputRef,
    );

    expect(options?.ok).toBe(true);
    expect(Array.isArray(options?.result?.options)).toBe(true);
  } finally {
    await srv.stop();
  }
});

test('vgplot: apply_state reports read-only DataHandle refs', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#us-state-map`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const handleRef = await firstStateRef(page, 'DataHandle');

    const result = await page.evaluate(async (ref) => {
      const vacp = globalThis.__vacp;
      const snap = await vacp.getState();
      const state = structuredClone(snap.state);
      state[ref] = { ...state[ref], auditProbe: 'json-tab-apply' };

      return await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.apply_state',
        params: { state },
      });
    }, handleRef);

    expect(result?.ok).toBe(true);
    expect(result?.result?.applied).toBe(0);
    expect(result?.result?.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: handleRef,
          reason: expect.stringMatching(/read-only|not controllable/i),
        }),
      ]),
    );
  } finally {
    await srv.stop();
  }
});

test('vgplot: apply_state restores PanZoom domains', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#pan-zoom`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const replay = await page.evaluate(async () => {
      const vacp = globalThis.__vacp;
      const snap = await vacp.getState();
      const panZoomEntry = Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'PanZoom');

      if (!panZoomEntry) throw new Error('Missing PanZoom state');
      const [ref, panZoom] = panZoomEntry;
      if (
        !panZoom ||
        typeof panZoom !== 'object' ||
        !('xDomain' in panZoom) ||
        !('yDomain' in panZoom) ||
        !('plotId' in panZoom)
      )
        throw new Error('Invalid pan/zoom state');
      if (!Array.isArray(panZoom.xDomain) || !Array.isArray(panZoom.yDomain))
        throw new Error('Missing pan/zoom domains');
      const [x0, x1] = panZoom.xDomain;
      const [y0, y1] = panZoom.yDomain;
      const xSpan = x1 - x0 || 1;
      const ySpan = y1 - y0 || 1;
      const interactorId = ref.split('/interactor/').at(-1);
      await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vgplot.set_pan_zoom',
        params: {
          plotId: panZoom.plotId,
          interactorId,
          x0: x0 + xSpan * 0.25,
          x1: x0 + xSpan * 0.75,
          y0: y0 + ySpan * 0.25,
          y1: y0 + ySpan * 0.75,
        },
      });
      const afterSet = await vacp.getState();
      const expected = structuredClone(afterSet.state[ref]);
      const clearResult = await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vgplot.clear_pan_zoom',
        params: { plotId: panZoom.plotId, interactorId },
      });
      const cleared = (await vacp.getState()).state[ref];

      const applyResult = await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.apply_state',
        params: { state: structuredClone(afterSet.state) },
      });

      const afterReplay = await vacp.getState();

      return { clearResult, cleared, applyResult, expected, actual: afterReplay.state[ref] };
    });

    expect(replay.clearResult.ok).toBe(true);
    expect(replay.cleared.x).toBeNull();
    expect(replay.cleared.y).toBeNull();
    expect(replay.applyResult?.ok).toBe(true);
    expect(replay.applyResult?.result?.errors ?? []).toEqual([]);
    expect(replay.actual?.x).toEqual(replay.expected?.x);
    expect(replay.actual?.y).toEqual(replay.expected?.y);
    expect(replay.actual?.x).toEqual(expect.any(Array));
    expect(replay.actual?.y).toEqual(expect.any(Array));
  } finally {
    await srv.stop();
  }
});

test('vgplot: slider input actions keep DataHandle SQL valid', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#athlete-height`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const refs = await page.evaluate(async () => {
      const vacp = globalThis.__vacp;
      const [caps, snap] = await Promise.all([vacp.getCapabilities(), vacp.getState()]);

      return {
        widgetRef: Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'Widget')?.[0],
        handleRef: Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'DataHandle')?.[0],
        inputActions: caps.graph.actions
          .map((action) => action.name)
          .filter((name) => name.startsWith('vgplot.set_input_')),
      };
    });

    expect(refs.widgetRef).toBeTruthy();
    expect(refs.handleRef).toBeTruthy();
    expect(refs.inputActions).toEqual(['vgplot.set_input_value']);

    const setResult = await page.evaluate(
      async (ref) =>
        await globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.set_input_value',
          params: { ref, value: [0, 20] },
        }),
      refs.widgetRef,
    );

    expect(setResult?.ok).toBe(true);

    const selected = await page.evaluate(
      async (handleRef) =>
        globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vacp.data_sql',
          params: {
            handleRef,
            sql: 'SELECT COUNT(*)::INTEGER AS n, MAX(batch)::INTEGER AS max_batch FROM vacp_handle',
          },
        }),
      refs.handleRef,
    );
    expect(selected.ok).toBe(true);
    expect(selected.result.rows[0].n).toBeGreaterThan(0);
    expect(selected.result.rows[0].max_batch).toBeLessThanOrEqual(20);

    const clearResult = await page.evaluate(
      async (ref) =>
        await globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.clear_input',
          params: { ref },
        }),
      refs.widgetRef,
    );

    expect(clearResult?.ok).toBe(true);

    const clearState = await page.evaluate(async () => await globalThis.__vacp.getState());
    expect(clearState?.state?.[refs.handleRef!]?.selectionWhere ?? null).toBeNull();

    const sqlResult = await page.evaluate(
      async (handleRef) =>
        await globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vacp.data_sql',
          params: {
            handleRef,
            sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle',
            maxRows: 10,
          },
        }),
      refs.handleRef,
    );

    expect(sqlResult?.ok).toBe(true);
    expect(sqlResult?.result?.rows?.[0]?.n).toBeGreaterThan(selected.result.rows[0].n);
  } finally {
    await srv.stop();
  }
});

test('vgplot: menu option indices update the chart and clear restores the default frame', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-inspector=1#moving-average`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);
    const inputRef = await firstStateRef(page, 'Widget');
    const line = page.locator('#app svg g[aria-label="line"] path').first();
    await expect(line).toHaveAttribute('d', /^M/);
    const originalPath = await line.getAttribute('d');

    const setResult = await page.evaluate(
      async (ref) =>
        globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.set_input_option_index',
          params: { ref, index: 1 },
        }),
      inputRef,
    );
    expect(setResult.ok).toBe(true);
    expect(setResult.result.value).toEqual([-3, 3]);
    await expect
      .poll(async () => {
        const path = await line.getAttribute('d');
        return Boolean(path?.startsWith('M') && path !== originalPath);
      })
      .toBe(true);
    expect((await page.evaluate(async () => globalThis.__vacp.getState())).state[inputRef].value).toEqual([-3, 3]);

    const clearResult = await page.evaluate(
      async (ref) =>
        globalThis.__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.clear_input',
          params: { ref },
        }),
      inputRef,
    );
    expect(clearResult.ok).toBe(true);
    expect(clearResult.result.value).toEqual([-6, 0]);
    await expect(line).toHaveAttribute('d', originalPath!);
    expect((await page.evaluate(async () => globalThis.__vacp.getState())).state[inputRef].value).toEqual([-6, 0]);
  } finally {
    await srv.stop();
  }
});

test('vgplot: transient hover state stays bounded and read-only during replay', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#normalize`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const nearest = await page.evaluate(async () => {
      const snap = await globalThis.__vacp.getState();

      return Object.values(snap.state).find((value: any) => value?.kind === 'Nearest') ?? null;
    });

    const actionNames = await page.evaluate(async () => {
      const caps = await globalThis.__vacp.getCapabilities();

      return (caps.graph.actions ?? []).map((action: any) => action.name);
    });

    expect(nearest).toBeTruthy();
    expect(actionNames).not.toContain('vgplot.set_nearest');
    expect(actionNames).not.toContain('vgplot.clear_nearest');
    expect(nearest).toEqual(
      expect.objectContaining({
        kind: 'Nearest',
        selectionBacked: false,
      }),
    );
    expect(JSON.stringify(nearest).length).toBeLessThan(4_000);

    const result = await page.evaluate(async () => {
      const vacp = globalThis.__vacp;
      const snap = await vacp.getState();
      const state = structuredClone(snap.state);
      const nearestEntry = Object.entries(state).find(([, value]) => (value as any)?.kind === 'Nearest');

      if (!nearestEntry || !nearestEntry[1] || typeof nearestEntry[1] !== 'object')
        throw new Error('Missing transient hover state');
      const [ref, value] = nearestEntry;
      state[ref] = {
        ...value,
        value: ['2013-05-13T00:00:00.000Z'],
        selectionValue: {
          value: '2013-05-13T00:00:00.000Z',
          source: { value: ['2013-05-13T00:00:00.000Z'] },
          predicate: { type: 'IN' },
        },
      };

      const cleared = { ...snap.state, [ref]: { ...value, value: null } };
      const replay = async (operation: 'clear' | 'set', desired: typeof state) => {
        const applied = await vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vacp.apply_state',
          params: { state: desired },
        });
        const after = await vacp.getState();
        return { operation, applied, actual: after.state[ref] };
      };
      return { ref, replays: [await replay('clear', cleared), await replay('set', state)] };
    });

    for (const { operation, applied, actual } of result.replays) {
      expect(applied.ok, operation).toBe(true);
      expect(applied.result.applied, operation).toBe(0);
      expect(actual, operation).toEqual(nearest);
      expect(applied.result.errors ?? [], operation).toEqual([]);
      expect(applied.result.skipped ?? [], operation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: result.ref,
            reason: expect.stringMatching(/Nearest refs are transient hover state/i),
          }),
        ]),
      );
    }
  } finally {
    await srv.stop();
  }
});
