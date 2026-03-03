import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

function isRetryableExecutionContextError(error: unknown): boolean {
  const msg = String((error as { message?: unknown })?.message ?? error ?? '');
  return (
    msg.includes('Execution context was destroyed') ||
    msg.includes('Cannot find context with specified id') ||
    msg.includes('Target page, context or browser has been closed')
  );
}

async function waitForVacpBridge(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(globalThis as any).__vacp &&
      typeof (globalThis as any).__vacp.getCapabilities === 'function' &&
      typeof (globalThis as any).__vacp.getRuntime === 'function',
    undefined,
    { timeout: timeoutMs },
  );
}

async function evaluateWithVacpRetry<T>(args: {
  page: Page;
  label: string;
  evalFn: (payload: unknown) => Promise<T> | T;
  payload: unknown;
  maxAttempts?: number;
}): Promise<T> {
  const maxAttempts = args.maxAttempts ?? 4;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await args.page.evaluate(args.evalFn, args.payload);
    } catch (error) {
      lastError = error;
      if (!isRetryableExecutionContextError(error) || attempt >= maxAttempts) throw error;
      await args.page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
      await waitForVacpBridge(args.page, 15_000).catch(() => {});
      await args.page.waitForTimeout(80 * attempt);
    }
  }
  throw lastError ?? new Error(`Failed ${args.label}: unknown error`);
}

async function expectBridge(page: Page): Promise<void> {
  await waitForVacpBridge(page);
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
  return await evaluateWithVacpRetry({
    page,
    label: 'getCapabilities',
    payload: null,
    evalFn: async () => await (globalThis as any).__vacp.getCapabilities(),
  });
}

async function getState(page: Page): Promise<any> {
  return await evaluateWithVacpRetry({
    page,
    label: 'getState',
    payload: null,
    evalFn: async () => await (globalThis as any).__vacp.getState(),
  });
}

async function getRuntime(page: Page): Promise<any> {
  return await evaluateWithVacpRetry({
    page,
    label: 'getRuntime',
    payload: null,
    evalFn: async () => await (globalThis as any).__vacp.getRuntime(),
  });
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
  return await evaluateWithVacpRetry({
    page,
    label: 'vacp.data_sql',
    payload: args,
    evalFn: async (payload) => {
      const { handleRef, sql, maxRows } = payload as { handleRef: string; sql: string; maxRows?: number };
      return await (globalThis as any).__vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.data_sql',
        params: { handleRef, sql, format: 'json', maxRows: maxRows ?? 500 },
      });
    },
  });
}

async function dataSchema(
  page: Page,
  args: { handleRef: string; detail?: 'columns' | 'full'; sampleRows?: number },
): Promise<any> {
  return await evaluateWithVacpRetry({
    page,
    label: 'vacp.data_schema',
    payload: args,
    evalFn: async (payload) => {
      const { handleRef, detail, sampleRows } = payload as {
        handleRef: string;
        detail?: 'columns' | 'full';
        sampleRows?: number;
      };
      return await (globalThis as any).__vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.data_schema',
        params: { handleRef, detail, sampleRows },
      });
    },
  });
}

async function executeVacp(page: Page, args: { name: string; params?: Record<string, unknown> }): Promise<any> {
  return await evaluateWithVacpRetry({
    page,
    label: `execute:${args.name}`,
    payload: args,
    evalFn: async (payload) => {
      const { name, params } = payload as { name: string; params?: Record<string, unknown> };
      return await (globalThis as any).__vacp.execute({ callId: crypto.randomUUID(), name, params: params ?? {} });
    },
  });
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

test('examples: vgplot-gallery', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
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
      await waitForCapabilityRefContains(page, `/vgplot/${specId}`);

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
        (n: any) => n?.kind === 'DataHandle' && String(n?.ref ?? '').includes(`/vgplot/${specId}/`),
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
  const srv = await startViteDevServer({ name: 'vega-lite-gallery', cwd: exampleDir('vega-lite-gallery') });
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

      // Interaction-heavy hover/click SQL semantics are covered in dedicated
      // Vega-Lite tests. Keep this suite focused on cross-example smoke wiring.
      const state = await getState(page);
      expect(state && typeof state === 'object').toBeTruthy();
    }
  } finally {
    await srv.stop();
  }
});

test('examples: react-dashboard', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'react-dashboard', cwd: exampleDir('react-dashboard') });
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
