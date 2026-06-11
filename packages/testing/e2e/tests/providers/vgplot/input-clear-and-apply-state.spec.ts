import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(globalThis as any).__vacp &&
      typeof (globalThis as any).__vacp.getState === 'function' &&
      typeof (globalThis as any).__vacp.execute === 'function',
  );
}

async function firstStateRef(page: Page, kind: string): Promise<string> {
  const ref = await page.evaluate(async (kind) => {
    const vacp = (globalThis as any).__vacp;
    const snap = await vacp.getState();
    return Object.entries(snap.state).find(([, value]) => (value as any)?.kind === kind)?.[0] ?? null;
  }, kind);
  if (!ref) throw new Error(`Missing state ref for ${kind}`);
  return ref;
}

test('vgplot: clear_input keeps menu snapshots readable', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#aeromagnetic-survey`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const inputRef = await firstStateRef(page, 'Widget');
    const result = await page.evaluate(
      async (ref) =>
        await (globalThis as any).__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.clear_input',
          params: { ref },
        }),
      inputRef,
    );
    expect(result?.ok).toBe(true);

    const snapshot = await page.evaluate(async () => await (globalThis as any).__vacp.getState());
    expect(snapshot?.state?.[inputRef]?.kind).toBe('Widget');

    const options = await page.evaluate(
      async (ref) =>
        await (globalThis as any).__vacp.execute({
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
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#us-state-map`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const handleRef = await firstStateRef(page, 'DataHandle');
    const result = await page.evaluate(
      async (ref) => {
        const vacp = (globalThis as any).__vacp;
        const snap = await vacp.getState();
        const state = structuredClone(snap.state);
        state[ref] = { ...state[ref], auditProbe: 'json-tab-apply' };
        return await vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vacp.apply_state',
          params: { state },
        });
      },
      handleRef,
    );

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

test('vgplot: apply_state replays PanZoom domains instead of clearing them', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${srv.url}?vacp-debug=1#pan-zoom`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const replay = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const snap = await vacp.getState();
      const panZoomEntry = Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'PanZoom');
      if (!panZoomEntry) throw new Error('Missing PanZoom state');
      const [ref, panZoom] = panZoomEntry as [string, any];
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
      const applyResult = await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.apply_state',
        params: { state: structuredClone(afterSet.state) },
      });
      const afterReplay = await vacp.getState();
      return { applyResult, expected, actual: afterReplay.state[ref] };
    });

    expect(replay.applyResult?.ok).toBe(true);
    expect(replay.applyResult?.result?.errors ?? []).toEqual([]);
    expect(replay.actual?.x).toEqual(replay.expected?.x);
    expect(replay.actual?.y).toEqual(replay.expected?.y);
    expect(replay.actual?.x).toEqual(expect.any(Array));
    expect(replay.actual?.y).toEqual(expect.any(Array));
    await page.waitForTimeout(500);
    expect(pageErrors.join('\n')).not.toContain('values is not iterable');
  } finally {
    await srv.stop();
  }
});

test('vgplot: slider input actions keep DataHandle SQL valid', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#athlete-height`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const refs = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const [caps, snap] = await Promise.all([vacp.getCapabilities(), vacp.getState()]);
      return {
        widgetRef: Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'Widget')?.[0],
        handleRef: Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'DataHandle')?.[0],
        actionNames: (caps.graph.actions ?? []).map((action: any) => action.name),
      };
    });
    expect(refs.widgetRef).toBeTruthy();
    expect(refs.handleRef).toBeTruthy();
    expect(refs.actionNames).not.toContain('vgplot.set_input_option_index');

    const setResult = await page.evaluate(
      async (ref) =>
        await (globalThis as any).__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.set_input_value',
          params: { ref, value: [0, 20] },
        }),
      refs.widgetRef,
    );
    expect(setResult?.ok).toBe(true);

    const setState = await page.evaluate(async () => await (globalThis as any).__vacp.getState());
    const whereAfterSet = setState?.state?.[refs.handleRef!]?.selectionWhere;
    expect(whereAfterSet).toEqual(expect.any(String));
    expect(whereAfterSet).not.toContain('0,20');
    expect(whereAfterSet).not.toContain('NULL');

    const clearResult = await page.evaluate(
      async (ref) =>
        await (globalThis as any).__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.clear_input',
          params: { ref },
        }),
      refs.widgetRef,
    );
    expect(clearResult?.ok).toBe(true);

    const clearState = await page.evaluate(async () => await (globalThis as any).__vacp.getState());
    expect(clearState?.state?.[refs.handleRef!]?.selectionWhere ?? null).toBeNull();

    const sqlResult = await page.evaluate(
      async (handleRef) =>
        await (globalThis as any).__vacp.execute({
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
    expect(sqlResult?.result?.rows?.[0]?.n).toEqual(expect.any(Number));
  } finally {
    await srv.stop();
  }
});

test('vgplot: menu option index preserves complex option values', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#moving-average`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const inputRef = await firstStateRef(page, 'Widget');
    const setResult = await page.evaluate(
      async (ref) =>
        await (globalThis as any).__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.set_input_option_index',
          params: { ref, index: 0 },
        }),
      inputRef,
    );
    expect(setResult?.ok).toBe(true);
    expect(setResult?.result?.value).toEqual([-6, 0]);

    const clearResult = await page.evaluate(
      async (ref) =>
        await (globalThis as any).__vacp.execute({
          callId: crypto.randomUUID(),
          name: 'vgplot.clear_input',
          params: { ref },
        }),
      inputRef,
    );
    expect(clearResult?.ok).toBe(true);
    expect(clearResult?.result?.value).toEqual([-6, 0]);

    await page.waitForTimeout(500);
    expect(pageErrors.join('\n')).not.toContain('ROWS BETWEEN - PRECEDING');
    expect(pageErrors.join('\n')).not.toContain('syntax error');
  } finally {
    await srv.stop();
  }
});

test('vgplot: state snapshots bound complex interactor internals', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#normalize`, { waitUntil: 'domcontentloaded' });
    await waitForBridge(page);

    const nearest = await page.evaluate(async () => {
      const snap = await (globalThis as any).__vacp.getState();
      return Object.values(snap.state).find((value: any) => value?.kind === 'Nearest') ?? null;
    });
    const actionNames = await page.evaluate(async () => {
      const caps = await (globalThis as any).__vacp.getCapabilities();
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
    expect(() => JSON.stringify(nearest)).not.toThrow();
    expect(JSON.stringify(nearest).length).toBeLessThan(4_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const replayCurrent = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const snap = await vacp.getState();
      return await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.apply_state',
        params: { state: structuredClone(snap.state) },
      });
    });
    expect(replayCurrent?.ok).toBe(true);
    expect(replayCurrent?.result?.applied).toBe(0);
    expect(replayCurrent?.result?.skipped ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringMatching(/Nearest refs are transient hover state/i),
        }),
      ]),
    );

    const result = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const snap = await vacp.getState();
      const state = structuredClone(snap.state);
      const nearestEntry = Object.entries(state).find(([, value]) => (value as any)?.kind === 'Nearest');
      if (nearestEntry) {
        const [ref, value] = nearestEntry as [string, any];
        state[ref] = {
          ...value,
          value: ['2013-05-13T00:00:00.000Z'],
          selectionValue: {
            value: '2013-05-13T00:00:00.000Z',
            source: { value: ['2013-05-13T00:00:00.000Z'] },
            predicate: { type: 'IN' },
          },
        };
      }
      return await vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.apply_state',
        params: { state },
      });
    });

    expect(result?.ok).toBe(true);
    expect(result?.result?.errors ?? []).toEqual([]);
    expect(result?.result?.skipped ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringMatching(/Nearest refs are transient hover state/i),
        }),
      ]),
    );
    await page.waitForTimeout(500);
    expect(pageErrors.join('\n')).not.toContain('[object Object]');
    expect(pageErrors.join('\n')).not.toContain('2013-05-13T00:00:00.000Z');
  } finally {
    await srv.stop();
  }
});
