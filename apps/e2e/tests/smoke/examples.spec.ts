import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { executeOperation, operationNames } from '../providers/operations';

async function waitForVacpBridge(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () =>
      !!globalThis.__vacp &&
      typeof globalThis.__vacp.getCapabilities === 'function' &&
      typeof globalThis.__vacp.getRuntime === 'function',
    undefined,
    { timeout: timeoutMs },
  );
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
  expect(typeof manifest?.graph?.scriptId).toBe('string');
  expect(typeof manifest?.state?.indexScriptId).toBe('string');
  expect(typeof manifest?.state?.catalogScriptId).toBe('string');

  const graphRaw = await page.evaluate(
    (id) => document.getElementById(String(id))?.textContent ?? '',
    manifest.graph.scriptId,
  );

  const graph = JSON.parse(graphRaw);
  expect(Array.isArray(graph?.graph?.nodes)).toBeTruthy();
  expect(Array.isArray(graph?.graph?.actions)).toBeTruthy();

  const stateIndexRaw = await page.evaluate(
    (id) => document.getElementById(String(id))?.textContent ?? '',
    manifest.state.indexScriptId,
  );

  const stateIndex = JSON.parse(stateIndexRaw);
  expect(Array.isArray(stateIndex?.changedRefs)).toBeTruthy();
  expect(Array.isArray(stateIndex?.removedRefs)).toBeTruthy();
  expect(typeof stateIndex?.catalog?.scriptId).toBe('string');

  const stateCatalogRaw = await page.evaluate(
    (id) => document.getElementById(String(id))?.textContent ?? '',
    manifest.state.catalogScriptId,
  );

  const stateCatalog = JSON.parse(stateCatalogRaw);
  expect(Array.isArray(stateCatalog?.refs)).toBeTruthy();

  const firstRef = (stateCatalog?.refs ?? [])[0];

  expect(firstRef?.scriptId).toEqual(expect.any(String));
  const refRaw = await page.evaluate((id) => document.getElementById(String(id))?.textContent ?? '', firstRef.scriptId);
  const refPayload = JSON.parse(refRaw);
  expect(refPayload.ref).toBe(firstRef.ref);
  expect(Object.hasOwn(refPayload, 'value')).toBe(true);

  return { manifest, graph, stateIndex, stateCatalog };
}

async function getCapabilities(page: Page): Promise<any> {
  return page.evaluate(() => globalThis.__vacp.getCapabilities());
}

async function getState(page: Page): Promise<any> {
  return page.evaluate(() => globalThis.__vacp.getState());
}

async function getRuntime(page: Page): Promise<any> {
  return page.evaluate(() => globalThis.__vacp.getRuntime());
}

async function dataSql(page: Page, args: { handleRef: string; sql: string; maxRows?: number }): Promise<any> {
  return executeOperation(page, 'vacp.data_sql', { ...args, format: 'json', maxRows: args.maxRows ?? 500 });
}

async function dataSchema(
  page: Page,
  args: { handleRef: string; detail?: 'columns' | 'full'; sampleRows?: number },
): Promise<any> {
  return executeOperation(page, 'vacp.data_schema', args);
}

async function executeVacp(page: Page, args: { name: string; params?: Record<string, unknown> }): Promise<any> {
  return page.evaluate(
    ({ name, params }) => globalThis.__vacp.execute({ callId: crypto.randomUUID(), name, params: params ?? {} }),
    args,
  );
}

async function dispatchOperation(page: Page, contract: string, params: Record<string, unknown>): Promise<any> {
  const names = await operationNames(page, [contract]);
  return page.evaluate(
    ({ name, params }) =>
      globalThis.__vacp.dispatch(
        { callId: crypto.randomUUID(), name, params },
        { source: 'inspector', message: `smoke:${name}` },
      ),
    { name: names[contract]!, params },
  );
}

async function waitForCapabilityRefContains(page: Page, needle: string, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const caps = await getCapabilities(page);
        return caps.graph.nodes.some((node: { ref: string }) => node.ref.includes(needle));
      },
      { timeout, message: `Capability graph contains ${needle}` },
    )
    .toBe(true);
}

async function waitForHistoryLenAtLeast(page: Page, count: number, timeout = 15_000): Promise<void> {
  await expect
    .poll(async () => (await getRuntime(page)).history.length, {
      timeout,
      message: `History contains at least ${count} entries`,
    })
    .toBeGreaterThanOrEqual(count);
}

function countFromResult(res: any): number {
  const rows = res?.result?.rows ?? [];

  return rows?.[0]?.n;
}

function firstRowFromResult(res: any): Record<string, unknown> {
  const row = res?.result?.rows?.[0];
  expect(row && typeof row === 'object' && !Array.isArray(row)).toBeTruthy();

  return row as Record<string, unknown>;
}

async function expectDataSchemaWorks(page: Page, handleRef?: string): Promise<void> {
  const cap = await getCapabilities(page);
  const graph = cap?.graph ?? {};
  const nodes = graph.nodes ?? [];
  const actions = graph.actions ?? [];

  const handles = nodes.filter((n: any) => n?.kind === 'DataHandle' && typeof n?.ref === 'string');
  const target = handleRef ?? (handles[0]?.ref as string | undefined);

  if (!target) return;

  expect(actions.some((a: any) => a?.operation?.contract === 'vacp.data_schema')).toBeTruthy();

  await expect
    .poll(
      async () => {
        const result = await dataSchema(page, { handleRef: target, detail: 'columns' });
        return result.ok ? result.result.columns.length : 0;
      },
      { timeout: 15_000, message: 'DataHandle exposes its hydrated column schema' },
    )
    .toBeGreaterThan(0);
}

async function selectedCount(page: Page, handleRef: string): Promise<number> {
  const result = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
  expect(result.ok).toBeTruthy();
  const count = countFromResult(result);
  expect(typeof count).toBe('number');

  return count;
}

async function expectVgplotIntervalActionWorks(
  page: Page,
  graph: any,
  handleRef: string,
  allRows: number,
): Promise<void> {
  const actions = graph.actions ?? [];
  const nodes = graph.nodes ?? [];

  const target = nodes.find(
    (node: any) =>
      node?.kind === 'InteractionTarget' &&
      /Interval1D/i.test(String(node?.title ?? '')) &&
      typeof node?.data?.plotId === 'string' &&
      typeof node?.data?.interactorId === 'string',
  );

  expect(actions.some((action: any) => action?.operation?.contract === 'vgplot.set_interval_1d')).toBeTruthy();
  expect(target).toBeTruthy();

  const beforeRows = await selectedCount(page, handleRef);
  expect(beforeRows).toBe(allRows);
  const runtimeBefore = await getRuntime(page);
  const historyBefore = Array.isArray(runtimeBefore?.history) ? runtimeBefore.history.length : 0;

  const boundsResult = await dataSql(page, {
    handleRef,
    sql: [
      'SELECT',
      '  epoch_ms(MIN(make_date(2012, month(date), day(date))))::DOUBLE AS min_ms,',
      '  epoch_ms(MAX(make_date(2012, month(date), day(date))))::DOUBLE AS max_ms',
      'FROM vacp_all',
    ].join(' '),
  });

  expect(boundsResult.ok).toBeTruthy();
  const bounds = firstRowFromResult(boundsResult);
  const minMs = Number(bounds.min_ms);
  const maxMs = Number(bounds.max_ms);
  expect(Number.isFinite(minMs)).toBeTruthy();
  expect(Number.isFinite(maxMs)).toBeTruthy();
  expect(maxMs).toBeGreaterThan(minMs);
  const span = maxMs - minMs;

  const result = await dispatchOperation(page, 'vgplot.set_interval_1d', {
    plotId: target.data.plotId,
    interactorId: target.data.interactorId,
    min: minMs + span * 0.35,
    max: minMs + span * 0.6,
  });

  expect(result.ok).toBeTruthy();
  await waitForHistoryLenAtLeast(page, historyBefore + 1);

  await expect
    .poll(
      async () => {
        const count = await selectedCount(page, handleRef);

        return count > 0 && count < allRows;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const state = await getState(page);
  const handleState = state?.state?.[handleRef];
  expect(String(handleState?.selectionWhere ?? '')).toMatch(/date|BETWEEN|>=|<=/i);
}

async function expectVegaLiteIntervalSelectionWorks(
  page: Page,
  graph: any,
  handleRef: string,
  allRows: number,
): Promise<void> {
  const actions = graph.actions ?? [];
  const nodes = graph.nodes ?? [];

  const brush = nodes.find(
    (node: any) => node?.kind === 'Selection' && String(node?.ref ?? '').endsWith('/param/brush'),
  );

  expect(actions.map((action: any) => action?.operation?.contract)).toContain('vega_lite.set_selection');
  expect(typeof brush?.ref).toBe('string');

  const intervalValue = [Date.UTC(2012, 5, 1), Date.UTC(2012, 8, 1)];

  const result = await executeOperation(page, 'vega_lite.set_selection', {
    ref: brush.ref,
    value: { x: intervalValue },
  });

  expect(result.ok).toBe(true);

  await expect
    .poll(async () => {
      const count = await selectedCount(page, handleRef);

      return count > 0 && count < allRows;
    })
    .toBe(true);

  const state = await getState(page);
  const brushState = state?.state?.[brush.ref];
  const handleState = state?.state?.[handleRef];
  const brushValue = brushState && typeof brushState === 'object' ? brushState.value : undefined;
  expect(brushValue).toEqual(expect.objectContaining({ monthdate_date: intervalValue }));
  expect(String(handleState?.selectionWhere ?? '')).toMatch(/date|monthdate|>=|<=|BETWEEN/i);
}

test('examples: application options control raw SQL action registration', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);
    await waitForCapabilityRefContains(page, '/vgplot/weather');

    const enabledCaps = await getCapabilities(page);
    const enabledGraph = enabledCaps?.graph ?? {};
    const enabledActions = enabledGraph.actions ?? [];

    const enabledHandle = (enabledGraph.nodes ?? []).find(
      (node: any) => node?.kind === 'DataHandle' && String(node?.ref ?? '').includes('/vgplot/weather/'),
    );

    expect(typeof enabledHandle?.ref).toBe('string');
    expect(enabledActions.some((action: any) => action?.operation?.contract === 'vacp.data_sql')).toBeTruthy();

    const enabledSql = await dataSql(page, {
      handleRef: enabledHandle.ref as string,
      sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all',
    });

    expect(enabledSql.ok).toBeTruthy();
    expect(typeof countFromResult(enabledSql)).toBe('number');
    const sqlOperationNames = await operationNames(page, ['vacp.data_sql']);

    await page.addInitScript(() => {
      globalThis.__vacpExampleOptions = { enableSql: false };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectBridge(page);
    await waitForCapabilityRefContains(page, '/vgplot/weather');

    const disabledCaps = await getCapabilities(page);
    const disabledGraph = disabledCaps?.graph ?? {};
    const disabledActions = disabledGraph.actions ?? [];

    const disabledHandle = (disabledGraph.nodes ?? []).find(
      (node: any) => node?.kind === 'DataHandle' && String(node?.ref ?? '').includes('/vgplot/weather/'),
    );

    expect(typeof disabledHandle?.ref).toBe('string');
    expect(disabledActions.some((action: any) => action?.operation?.contract === 'vacp.data_sql')).toBeFalsy();
    expect(disabledActions.some((action: any) => action?.operation?.contract === 'vacp.data_schema')).toBeTruthy();

    await expectDataSchemaWorks(page, disabledHandle.ref as string);

    const disabledSql = await executeVacp(page, {
      name: sqlOperationNames['vacp.data_sql']!,
      params: { handleRef: disabledHandle.ref, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' },
    });
    expect(disabledSql.ok).toBe(false);
    expect(disabledSql.error?.message).toContain('Unknown action');
  } finally {
    await srv.stop();
  }
});

test('examples: vgplot-gallery', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);
    await expectDomSnapshotScript(page);

    // Avoid specs that require external network to load large parquet datasets. These can be
    // flaky/slow in CI (and are not essential for validating VACP wiring).
    const skipSpecs = new Set(['gaia', 'nyc-taxi-rides', 'observable-latency']);

    const specs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('#spec option')).map((o) => o.value),
    );

    expect(specs.length).toBeGreaterThanOrEqual(2);

    for (const specId of specs.filter((id) => !skipSpecs.has(id))) {
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
      const hasDataSql = actions.some((a: any) => a?.operation?.contract === 'vacp.data_sql');

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

      if (specId === 'weather') {
        await expectVgplotIntervalActionWorks(page, graph, handleRef, nAll);
      }
    }
  } finally {
    await srv.stop();
  }
});

test('examples: vega-lite-gallery', async ({ page }) => {
  const srv = await startAppServer({ name: 'vega-lite-gallery', cwd: exampleDir('vega-lite-gallery') });

  try {
    await page.goto(`${srv.url}`, { waitUntil: 'domcontentloaded' });
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
      expect(actions.some((a: any) => a?.operation?.contract === 'vacp.data_sql')).toBeTruthy();

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

      if (specId === 'seattle-weather') {
        await expectVegaLiteIntervalSelectionWorks(page, graph, handleRef, nAll);
      }

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
  const srv = await startAppServer({ name: 'react-dashboard', cwd: exampleDir('react-dashboard') });

  try {
    await page.goto(`${srv.url}`, { waitUntil: 'domcontentloaded' });
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
