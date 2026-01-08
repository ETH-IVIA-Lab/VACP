import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

type VacpBridge = {
  getCapabilities: () => Promise<any>;
  getState: () => Promise<any>;
  getRuntime: () => Promise<any>;
  getPlaybooks?: () => Promise<any>;
  execute: (call: { callId: string; name: string; params?: unknown }) => Promise<any>;
};

async function expectBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(globalThis as any).__vacp &&
      typeof (globalThis as any).__vacp.getCapabilities === 'function' &&
      typeof (globalThis as any).__vacp.getRuntime === 'function',
  );
}

async function getBridge(page: Page): Promise<VacpBridge> {
  await expectBridge(page);
  return await page.evaluate(() => (globalThis as any).__vacp);
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
  const step = (candidates[0] ?? steps.find((s: any) => s?.call)) as any;
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

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('examples: mosaic-gallery', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });
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

      await expectBridge(page);
      await waitForCapabilityRefContains(page, `/mosaic/${specId}`);

      const caps = await getCapabilities(page);
      const graph = caps?.graph ?? {};
      const actions = graph.actions ?? [];
      const nodes = graph.nodes ?? [];
      const hasDataSql = actions.some((a: any) => a?.name === 'vacp.data_sql');

      const handle = nodes.find((n: any) => n?.kind === 'DataHandle' && String(n?.ref ?? '').includes(`/mosaic/${specId}/`));
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

      const hasNonClearProviderAction = actions.some(
        (a: any) => typeof a?.name === 'string' && a.name.startsWith('mosaic.') && !/clear/i.test(String(a.name)),
      );
      const before = await getState(page);
      const rtBefore = await getRuntime(page);
      const beforeHist = (rtBefore.history ?? []).length;
      const ran = await tryRunFirstNonClearDemoStep(page);
      if (hasNonClearProviderAction) expect(ran).toBeTruthy();
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
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });
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

      await page.waitForSelector('svg', { timeout: 30_000 });
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

      // Trigger a human selection by clicking a mark path.
      const mark = page.locator('#app svg g.mark-symbol path').first();
      if (await mark.count()) {
        const mb = await mark.boundingBox();
        if (mb) {
          await page.mouse.click(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5);
          await page.waitForTimeout(250);
          const resSel = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
          expect(resSel.ok).toBeTruthy();
          const nSel = countFromResult(resSel);
          expect(nSel).toBeLessThanOrEqual(nAll);
        }
      }
    }
  } finally {
    await srv.stop();
  }
});

test('examples: d3-scatter-lasso', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'd3-scatter-lasso', cwd: resolve(examplesDir, 'd3-scatter-lasso') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);
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

    const rtBefore = await getRuntime(page);
    const beforeHist = (rtBefore.history ?? []).length;
    const ran = await tryRunFirstNonClearDemoStep(page);
    expect(ran).toBeTruthy();
    await waitForHistoryLenAtLeast(page, beforeHist + 1);
  } finally {
    await srv.stop();
  }
});

test('examples: vanilla-minimal', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vanilla-minimal', cwd: resolve(examplesDir, 'vanilla-minimal') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);

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

    const rtBefore = await getRuntime(page);
    const beforeHist = (rtBefore.history ?? []).length;

    await page.locator('#app svg circle[data-id="1"]').click();
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
