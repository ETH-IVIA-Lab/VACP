import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

async function expectBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(globalThis as any).__vacp &&
      typeof (globalThis as any).__vacp.getCapabilities === 'function' &&
      typeof (globalThis as any).__vacp.getRuntime === 'function',
  );
}

async function expectDomSnapshotScript(page: Page, scriptId = '__vacp_snapshot'): Promise<any> {
  await page.waitForFunction((id) => {
    const el = document.getElementById(String(id));
    if (!el || el.tagName !== 'SCRIPT') return false;
    const txt = el.textContent ?? '';
    return txt.trim().startsWith('{') && txt.trim().endsWith('}');
  }, scriptId);

  const raw = await page.evaluate((id) => document.getElementById(String(id))?.textContent ?? '', scriptId);
  const manifest = JSON.parse(raw);
  expect(manifest?.format).toBe('vacp.dom_snapshot');
  expect(Object.prototype.hasOwnProperty.call(manifest, 'version')).toBeFalsy();
  expect(typeof manifest?.graph?.scriptId).toBe('string');
  expect(typeof manifest?.state?.indexScriptId).toBe('string');
  expect(typeof manifest?.state?.catalogScriptId).toBe('string');

  const graphRaw = await page.evaluate(
    (id) => document.getElementById(String(id))?.textContent ?? '',
    manifest.graph.scriptId,
  );
  const graph = JSON.parse(graphRaw);
  expect(Object.prototype.hasOwnProperty.call(graph, 'version')).toBeFalsy();
  expect(Array.isArray(graph?.graph?.nodes)).toBeTruthy();
  expect(Array.isArray(graph?.graph?.actions)).toBeTruthy();

  const stateIndexRaw = await page.evaluate(
    (id) => document.getElementById(String(id))?.textContent ?? '',
    manifest.state.indexScriptId,
  );
  const stateIndex = JSON.parse(stateIndexRaw);
  expect(Object.prototype.hasOwnProperty.call(stateIndex, 'version')).toBeFalsy();
  expect(Array.isArray(stateIndex?.changedRefs)).toBeTruthy();
  expect(Array.isArray(stateIndex?.removedRefs)).toBeTruthy();
  expect(typeof stateIndex?.catalog?.scriptId).toBe('string');

  const stateCatalogRaw = await page.evaluate(
    (id) => document.getElementById(String(id))?.textContent ?? '',
    manifest.state.catalogScriptId,
  );
  const stateCatalog = JSON.parse(stateCatalogRaw);
  expect(Object.prototype.hasOwnProperty.call(stateCatalog, 'version')).toBeFalsy();
  expect(Array.isArray(stateCatalog?.refs)).toBeTruthy();

  const firstRef = (stateCatalog?.refs ?? [])[0];
  if (firstRef?.scriptId) {
    const refRaw = await page.evaluate(
      (id) => document.getElementById(String(id))?.textContent ?? '',
      firstRef.scriptId,
    );
    const refPayload = JSON.parse(refRaw);
    expect(Object.prototype.hasOwnProperty.call(refPayload, 'version')).toBeFalsy();
    expect(refPayload?.ref).toBe(firstRef.ref);
    expect(Object.prototype.hasOwnProperty.call(refPayload, 'value')).toBeTruthy();
  }
  return { manifest, graph, stateIndex, stateCatalog };
}

async function getCapabilities(page: Page): Promise<any> {
  return await page.evaluate(async () => await (globalThis as any).__vacp.getCapabilities());
}

async function getState(page: Page): Promise<any> {
  return await page.evaluate(async () => await (globalThis as any).__vacp.getState());
}

async function getRuntime(page: Page): Promise<any> {
  return await page.evaluate(async () => await (globalThis as any).__vacp.getRuntime());
}

async function getPlaybooks(page: Page): Promise<any[]> {
  await expectBridge(page);
  return await page.evaluate(async () => {
    const b = (globalThis as any).__vacp;
    if (!b) return [];
    if (typeof b.getPlaybooks === 'function') return await b.getPlaybooks();
    return [];
  });
}

async function tryRunFirstNonClearDemoStep(page: Page): Promise<boolean> {
  const playbooks = await getPlaybooks(page);
  if (!Array.isArray(playbooks) || playbooks.length === 0) return false;
  const steps = playbooks.flatMap((d: any) => (Array.isArray(d?.steps) ? d.steps : []));
  const candidates = steps.filter(
    (s: any) =>
      s?.call &&
      typeof s.call?.name === 'string' &&
      !/clear/i.test(String(s.call.name)) &&
      !/clear/i.test(String(s.title ?? '')),
  );
  const step = candidates[0] as any;
  if (!step?.call) return false;
  await page.evaluate(async (call) => {
    const b = (globalThis as any).__vacp;
    await b.execute({ callId: crypto.randomUUID(), name: call.name, params: call.params });
  }, step.call);
  return true;
}

async function dataSql(page: Page, args: { handleRef: string; sql: string; maxRows?: number }): Promise<any> {
  return await page.evaluate(
    async ({ handleRef, sql, maxRows }) =>
      await (globalThis as any).__vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.data_sql',
        params: { handleRef, sql, format: 'json', maxRows: maxRows ?? 500 },
      }),
    args,
  );
}

async function dataSchema(
  page: Page,
  args: { handleRef: string; detail?: 'columns' | 'full'; sampleRows?: number },
): Promise<any> {
  return await page.evaluate(
    async ({ handleRef, detail, sampleRows }) =>
      await (globalThis as any).__vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.data_schema',
        params: { handleRef, detail, sampleRows },
      }),
    args,
  );
}

async function executeVacp(page: Page, args: { name: string; params?: Record<string, unknown> }): Promise<any> {
  return await page.evaluate(
    async ({ name, params }) =>
      await (globalThis as any).__vacp.execute({ callId: crypto.randomUUID(), name, params: params ?? {} }),
    args,
  );
}

async function waitForCapabilityRefContains(page: Page, needle: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (true) {
    const ok = await page.evaluate(async (n) => {
      const caps = await (globalThis as any).__vacp.getCapabilities();
      const nodes = caps?.graph?.nodes ?? [];
      return nodes.some((x: any) => typeof x?.ref === 'string' && String(x.ref).includes(n));
    }, needle);
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for capability ref containing: ${needle}`);
    await page.waitForTimeout(150);
  }
}

async function waitForHistoryLenAtLeast(page: Page, n: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (true) {
    const rt = await getRuntime(page);
    const hist = Array.isArray(rt?.history) ? rt.history : [];
    if (hist.length >= n) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for history len >= ${n}`);
    await page.waitForTimeout(120);
  }
}

async function waitForHistoryAction(
  page: Page,
  args: { name: string; source?: string; minHistoryLen?: number },
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    const rt = await getRuntime(page);
    const hist = Array.isArray(rt?.history) ? rt.history : [];
    const minLen = args.minHistoryLen ?? 0;
    const okLen = hist.length >= minLen;
    const okEntry = hist.some(
      (h: any) =>
        h?.kind === 'action' && h?.call?.name === args.name && (args.source ? h?.source === args.source : true),
    );
    if (okLen && okEntry) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for history action: ${args.name} (source=${args.source ?? '*'})`);
    }
    await page.waitForTimeout(120);
  }
}

async function hoverUntilTooltipAction(page: Page, minHistoryLen: number, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();

  // We intentionally do not rely on `window.__vegaView` being present. Instead,
  // we take a best-effort set of mark centers from the rendered surface and
  // hover until the VACP adapter records a `vega_lite.hover_tooltip` action.
  const points = await page.evaluate(() => {
    const svg = document.querySelector('#app svg.marks');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates: Array<{ x: number; y: number; area: number }> = [];

    if (svg instanceof SVGSVGElement) {
      const elements = Array.from(
        svg.querySelectorAll<SVGGraphicsElement>('.role-mark rect, .role-mark path, .role-mark circle'),
      );

      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const x = rect.x + rect.width * 0.5;
        const y = rect.y + rect.height * 0.5;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) continue;
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (x < 0 || y < 0 || x > vw || y > vh) continue;
        candidates.push({ x, y, area: rect.width * rect.height });
      }

      // Prefer smaller marks (points/bars) to reduce the chance of hitting a large background.
      candidates.sort((a, b) => a.area - b.area);
      return candidates.slice(0, 80).map(({ x, y }) => ({ x, y }));
    }

    // Canvas fallback (Vega-Lite renderer="canvas"): probe a deterministic grid.
    const surface = document.querySelector<HTMLElement>('#app canvas.marks, #app svg.marks');
    if (!surface) return [];
    const rect = surface.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return [];
    if (rect.width <= 0 || rect.height <= 0) return [];

    const rows = 6;
    const cols = 12;
    const points: Array<{ x: number; y: number }> = [];
    for (let r = 1; r <= rows; r += 1) {
      for (let c = 1; c <= cols; c += 1) {
        const x = rect.x + (rect.width * c) / (cols + 1);
        const y = rect.y + (rect.height * r) / (rows + 1);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < 0 || y < 0 || x > vw || y > vh) continue;
        points.push({ x, y });
      }
    }
    return points;
  });

  if (points.length === 0) throw new Error('No Vega-Lite marks found to hover for tooltip');

  for (const point of points) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;

    await page.mouse.move(point.x, point.y);
    try {
      await waitForHistoryAction(
        page,
        { name: 'vega_lite.hover_tooltip', source: 'human', minHistoryLen },
        Math.min(2_000, remainingMs),
      );
      return;
    } catch {
      // Try the next mark.
    }
  }

  throw new Error('Timed out hovering marks waiting for a Vega-Lite tooltip action');
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function countFromResult(res: any): number {
  const rows = res?.result?.rows ?? [];
  return rows?.[0]?.n;
}

async function expectDataSchemaWorks(page: Page, handleRef?: string): Promise<void> {
  const cap = await getCapabilities(page);
  const graph = cap?.graph ?? {};
  const nodes = graph.nodes ?? [];
  const actions = graph.actions ?? [];

  const handles = nodes.filter((n: any) => n?.kind === 'DataHandle' && typeof n?.ref === 'string');
  const target = handleRef ?? (handles[0]?.ref as string | undefined);
  if (!target) return;

  expect(actions.some((a: any) => a?.name === 'vacp.data_schema')).toBeTruthy();

  let last: any = null;
  for (let i = 0; i < 20; i += 1) {
    // Some providers need a moment to hydrate data before schema queries succeed.
    last = await dataSchema(page, { handleRef: target, detail: 'columns' });
    if (last?.ok) break;
    await page.waitForTimeout(150);
  }

  expect(last?.ok).toBeTruthy();
  expect(Array.isArray(last?.result?.columns)).toBeTruthy();
  expect(last?.result?.columns?.length).toBeGreaterThan(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('examples: mosaic-gallery', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);
    await expectDomSnapshotScript(page);

    // Avoid specs that require external network to load large parquet datasets. These can be
    // flaky/slow in CI (and are not essential for validating VACP wiring).
    const skipSpecs = new Set(['gaia', 'nyc-taxi-rides', 'observable-latency', 'linear-regression-10m', 'flights-10m']);

    const supportedPlaybookSpecs = new Set([
      'athletes',
      'crossfilter',
      'flights-hexbin',
      'line-multi-series',
      'normalize',
      'pan-zoom',
      'us-state-map',
      'weather',
      'wnba-shots',
    ]);

    const specs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('#spec option')).map((o) => ({
        id: o.value,
        title: (o.textContent ?? o.value).trim() || o.value,
      })),
    );
    expect(specs.length).toBeGreaterThanOrEqual(2);

    for (const { id: specId, title: specTitle } of specs.filter((s) => !skipSpecs.has(s.id))) {
      await page.evaluate((id) => {
        const sel = document.querySelector<HTMLSelectElement>('#spec');
        if (!sel) throw new Error('Missing #spec');
        sel.value = id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, specId);

      await expectBridge(page);
      await waitForCapabilityRefContains(page, `/mosaic/${specId}`);

      const caps = await getCapabilities(page);
      const graph = caps?.graph ?? {};
      const actions = graph.actions ?? [];
      const nodes = graph.nodes ?? [];
      const hasDataSql = actions.some((a: any) => a?.name === 'vacp.data_sql');

      const playbooks = await getPlaybooks(page);
      if (supportedPlaybookSpecs.has(specId)) expect(playbooks.length).toBeGreaterThan(0);
      else expect(playbooks.length).toBe(0);

      if (playbooks.length) {
        expect(
          playbooks.every((p: any) => typeof p?.id === 'string' && String(p.id).startsWith(`${specId}-`)),
        ).toBeTruthy();
        expect(
          playbooks.some(
            (p: any) =>
              typeof p?.title === 'string' && String(p.title).toLowerCase().includes(String(specTitle).toLowerCase()),
          ),
        ).toBeTruthy();

        const calls = playbooks
          .flatMap((p: any) => (Array.isArray(p?.steps) ? p.steps : []))
          .map((s: any) => s?.call)
          .filter(Boolean);
        expect(calls.some((c: any) => c?.name === 'vacp.data_sql')).toBeFalsy();
      }

      const handle = nodes.find(
        (n: any) => n?.kind === 'DataHandle' && String(n?.ref ?? '').includes(`/mosaic/${specId}/`),
      );
      if (!handle) {
        expect(hasDataSql).toBeFalsy();
        continue;
      }
      expect(hasDataSql).toBeTruthy();

      expect(typeof handle?.ref).toBe('string');
      const handleRef = handle.ref as string;
      const handleTable = (handle as any)?.data?.table;

      const resAll = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' });
      expect(resAll.ok).toBeTruthy();
      const nAll = countFromResult(resAll);
      expect(typeof nAll).toBe('number');
      if (typeof handleTable === 'string' && handleTable) expect(nAll).toBeGreaterThan(0);

      if (typeof handleTable === 'string' && handleTable) {
        await expectDataSchemaWorks(page, handleRef);
      }

      const before = await getState(page);
      const rtBefore = await getRuntime(page);
      const beforeHist = (rtBefore.history ?? []).length;
      const steps = playbooks.flatMap((d: any) => (Array.isArray(d?.steps) ? d.steps : []));
      const hasNonClearPlaybookCall = steps.some(
        (s: any) =>
          s?.call &&
          typeof s.call?.name === 'string' &&
          !/clear/i.test(String(s.call.name)) &&
          !/clear/i.test(String(s.title ?? '')),
      );
      const ran = await tryRunFirstNonClearDemoStep(page);
      expect(ran).toBe(hasNonClearPlaybookCall);
      if (ran) {
        await waitForHistoryLenAtLeast(page, beforeHist + 1);
        const afterSet = await getState(page);
        expect(stableJson(before)).not.toEqual(stableJson(afterSet));
      }
    }
  } finally {
    await srv.stop();
  }
});

test('examples: vega-lite-gallery', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vega-lite-gallery', cwd: resolve(examplesDir, 'vega-lite-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);

    const specIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('#spec option')).map((o) => o.value),
    );
    expect(specIds.length).toBeGreaterThanOrEqual(2);

    for (const specId of specIds) {
      await page.evaluate((id) => {
        const sel = document.querySelector<HTMLSelectElement>('#spec');
        if (!sel) throw new Error('Missing #spec');
        sel.value = id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, specId);

      await page.waitForSelector('#app canvas.marks, #app svg.marks', { timeout: 30_000 });
      await expectBridge(page);
      await waitForCapabilityRefContains(page, `/vega-lite/${specId}/${specId}`);

      const caps = await getCapabilities(page);
      const graph = caps?.graph ?? {};
      const actions = graph.actions ?? [];
      const nodes = graph.nodes ?? [];
      expect(actions.some((a: any) => a?.name === 'vacp.data_sql')).toBeTruthy();

      const handle = nodes.find(
        (n: any) => n?.kind === 'DataHandle' && String(n?.ref ?? '').includes(`/vega-lite/${specId}/`),
      );
      expect(typeof handle?.ref).toBe('string');
      const handleRef = handle.ref as string;

      const resAll = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' });
      expect(resAll.ok).toBeTruthy();
      const nAll = countFromResult(resAll);
      expect(typeof nAll).toBe('number');
      expect(nAll).toBeGreaterThan(0);

      await expectDataSchemaWorks(page, handleRef);

      const resBase = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
      expect(resBase.ok).toBeTruthy();
      const nBase = countFromResult(resBase);
      expect(typeof nBase).toBe('number');
      expect(nBase).toBeGreaterThan(0);
      expect(nBase).toBeLessThanOrEqual(nAll);

      // Prefer a real hover capture; if renderer/layout blocks deterministic hover hit-testing,
      // fall back to a canonical hover call from the playbook.
      let hoverParams: Record<string, unknown> | null = null;
      const rtBeforeHover = await getRuntime(page);
      const beforeHoverHist = Array.isArray(rtBeforeHover?.history) ? rtBeforeHover.history.length : 0;
      try {
        await hoverUntilTooltipAction(page, beforeHoverHist + 1);
        const rtAfterHover = await getRuntime(page);
        const lastHumanHover = [...(rtAfterHover.history ?? [])].reverse().find(
          (h: any) => h?.kind === 'action' && h?.call?.name === 'vega_lite.hover_tooltip' && h?.source === 'human',
        );
        hoverParams = (lastHumanHover?.call?.params ?? null) as Record<string, unknown> | null;
      } catch {
        // Fallback below.
      }

      if (!hoverParams) {
        hoverParams = (await page.evaluate(async () => {
          const b = (globalThis as any).__vacp;
          const playbooks = (typeof b?.getPlaybooks === 'function' ? await b.getPlaybooks() : []) as any[];
          const steps = playbooks.flatMap((p: any) => (Array.isArray(p?.steps) ? p.steps : []));
          const hoverStep = steps.find(
            (s: any) => s?.call?.name === 'vega_lite.hover_tooltip' && !Boolean(s?.call?.params?.clear),
          );
          return (hoverStep?.call?.params ?? null) as Record<string, unknown> | null;
        })) as Record<string, unknown> | null;
      }
      expect(hoverParams).toBeTruthy();

      const rtBeforeClear = await getRuntime(page);
      const beforeClearHist = Array.isArray(rtBeforeClear?.history) ? rtBeforeClear.history.length : 0;
      await executeVacp(page, { name: 'vega_lite.hover_tooltip', params: { clear: true } });
      await waitForHistoryAction(page, {
        name: 'vega_lite.hover_tooltip',
        source: 'agent',
        minHistoryLen: beforeClearHist + 1,
      });

      const resCleared = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
      expect(resCleared.ok).toBeTruthy();
      const nCleared = countFromResult(resCleared);
      expect(typeof nCleared).toBe('number');
      expect(nCleared).toBe(nBase);

      const rtBeforeAgentHover = await getRuntime(page);
      const beforeAgentHoverHist = Array.isArray(rtBeforeAgentHover?.history) ? rtBeforeAgentHover.history.length : 0;
      await executeVacp(page, { name: 'vega_lite.hover_tooltip', params: hoverParams ?? {} });
      await waitForHistoryAction(page, {
        name: 'vega_lite.hover_tooltip',
        source: 'agent',
        minHistoryLen: beforeAgentHoverHist + 1,
      });

      const resHover = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
      expect(resHover.ok).toBeTruthy();
      const nHover = countFromResult(resHover);
      expect(typeof nHover).toBe('number');
      expect(nHover).toBeGreaterThan(0);
      expect(nHover).toBeLessThanOrEqual(nAll);
      expect(nHover).toBeLessThan(nAll);

      const rtBeforeAgentHoverAgain = await getRuntime(page);
      const beforeAgentHoverAgainHist = Array.isArray(rtBeforeAgentHoverAgain?.history)
        ? rtBeforeAgentHoverAgain.history.length
        : 0;
      await executeVacp(page, { name: 'vega_lite.hover_tooltip', params: hoverParams ?? {} });
      await waitForHistoryAction(page, {
        name: 'vega_lite.hover_tooltip',
        source: 'agent',
        minHistoryLen: beforeAgentHoverAgainHist + 1,
      });

      const resAgentHoverAgain = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
      expect(resAgentHoverAgain.ok).toBeTruthy();
      const nAgentHoverAgain = countFromResult(resAgentHoverAgain);
      expect(typeof nAgentHoverAgain).toBe('number');
      expect(nAgentHoverAgain).toBe(nHover);

      // Trigger a best-effort human selection by clicking into the rendered chart.
      const marks = page.locator('#app canvas.marks, #app svg.marks').first();
      if (await marks.count()) {
        const box = await marks.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
          await page.waitForTimeout(250);
        }
      }

      const resSel = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
      expect(resSel.ok).toBeTruthy();
      const nSel = countFromResult(resSel);
      expect(nSel).toBeLessThanOrEqual(nAll);
    }
  } finally {
    await srv.stop();
  }
});

test('examples: react-dashboard', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'react-dashboard', cwd: resolve(examplesDir, 'react-dashboard') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);

    await executeVacp(page, { name: 'dashboard.set_dataset', params: { id: 'iris' } });
    await executeVacp(page, {
      name: 'dashboard.set_encoding',
      params: { x: 'SepalLengthCm', y: 'PetalLengthCm', color: 'Species' },
    });

    const caps = await getCapabilities(page);
    const graph = caps?.graph ?? {};
    const nodes = graph.nodes ?? [];
    const handle = nodes.find((n: any) => n?.kind === 'DataHandle');
    expect(typeof handle?.ref).toBe('string');
    const handleRef = handle.ref as string;

    const resAll = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' });
    expect(resAll.ok).toBeTruthy();
    const nAll = countFromResult(resAll);
    expect(nAll).toBeGreaterThan(0);

    await expectDataSchemaWorks(page, handleRef);

    await page.waitForSelector('svg circle[data-point-id]', { timeout: 30_000 });

    const rtBefore = await getRuntime(page);
    const beforeHist = (rtBefore.history ?? []).length;

    await page.locator('svg circle[data-point-id]').first().click({ force: true });
    await waitForHistoryLenAtLeast(page, beforeHist + 1);

    const resSel = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
    expect(resSel.ok).toBeTruthy();
    const nSel = countFromResult(resSel);
    expect(nSel).toBe(1);
    expect(nSel).toBeLessThanOrEqual(nAll);
  } finally {
    await srv.stop();
  }
});
