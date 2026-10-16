import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';

import { gotoApp } from '../helpers/servers';
import { executeOperation, operationNames } from '../providers/operations';

async function waitForVacpBridge(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () =>
      !!globalThis.__vacp &&
      typeof globalThis.__vacp.getCapabilities === 'function' &&
      typeof globalThis.__vacp.getProvenance === 'function',
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
  return page.evaluate(() => globalThis.__vacp.observe());
}

async function getProvenance(page: Page): Promise<any> {
  return page.evaluate(() => globalThis.__vacp.getProvenance());
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
      globalThis.__vacp.execute(
        { callId: crypto.randomUUID(), name, params },
        { actor: { id: 'inspector', kind: 'human' } },
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
    .poll(async () => (await getProvenance(page)).records.length, {
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

async function expectDataSchemaWorks(page: Page, target: string): Promise<void> {
  const cap = await getCapabilities(page);
  const actions = cap?.graph?.actions ?? [];

  expect(actions.some((a: any) => a?.operation?.contract === 'vacp.data_schema')).toBeTruthy();

  await expect
    .poll(
      async () => {
        const result = await dataSchema(page, { handleRef: target, detail: 'columns' });
        return result.ok ? result.result.vacp_handle.columns.length : 0;
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
    (node: any) => node?.kind === 'InteractionTarget' && /Interval1D/i.test(String(node?.title ?? '')),
  );

  expect(actions.some((action: any) => action?.operation?.contract === 'vgplot.set_interval_1d')).toBeTruthy();
  expect(target).toBeTruthy();

  const beforeRows = await selectedCount(page, handleRef);
  expect(beforeRows).toBe(allRows);
  const runtimeBefore = await getProvenance(page);
  const historyBefore = Array.isArray(runtimeBefore?.records) ? runtimeBefore.records.length : 0;

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
    ref: target.ref,
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

  // The published predicate selects exactly the rows the handle exposes.
  const state = await getState(page);
  const where = String(state?.state?.[handleRef]?.selectionWhere ?? '');
  expect(where).not.toBe('');
  const matching = await dataSql(page, {
    handleRef,
    sql: `SELECT COUNT(*)::INTEGER AS n FROM vacp_all WHERE ${where}`,
  });
  expect(matching.ok).toBeTruthy();
  expect(countFromResult(matching)).toBe(await selectedCount(page, handleRef));
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
  expect(String(handleState?.selectionWhere ?? '')).not.toBe('');
  // Derive the month-and-day time unit from the source rows on the axis's local clock, independently of
  // the handle's own table. That clock is the page's time zone, so the page writes the bounds.
  const [from, to] = await page.evaluate((times) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return times.map((time) => {
      const date = new Date(time);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    });
  }, intervalValue);
  const matching = await dataSql(page, {
    handleRef,
    sql: `SELECT COUNT(*)::INTEGER AS n FROM vacp_all WHERE make_timestamp(2012, month(date), day(date), 0, 0, 0) BETWEEN TIMESTAMP '${from}' AND TIMESTAMP '${to}'`,
  });
  expect(countFromResult(matching)).toBe(await selectedCount(page, handleRef));
}

test('examples: application options control raw SQL action registration', async ({ page }) => {
  await gotoApp(page, 'vgplot-gallery', '#weather');
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
    globalThis.__vacpExampleOptions = { ...globalThis.__vacpExampleOptions, enableSql: false };
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
});

test('examples: vgplot-gallery', async ({ page }) => {
  await gotoApp(page, 'vgplot-gallery');
  await expectDomSnapshotScript(page);

  // These specs load large remote datasets, which the sweep skips to stay off the network.
  const skipSpecs = new Set(['gaia', 'nyc-taxi-rides', 'observable-latency']);
  // Every other spec declares data, so each must publish a queryable DataHandle.
  const specsWithoutData = new Set(['axes', 'legends']);

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

    if (specsWithoutData.has(specId)) {
      expect(handle).toBeUndefined();
      expect(hasDataSql).toBe(false);
      continue;
    }

    expect(handle?.ref, `${specId} publishes a DataHandle`).toEqual(expect.any(String));
    expect(handle.data?.table, `${specId} names its table`).toEqual(expect.any(String));
    expect(hasDataSql, `${specId} offers SQL`).toBe(true);
    const handleRef = handle.ref as string;

    const resAll = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' });
    expect(resAll.ok).toBe(true);
    const nAll = countFromResult(resAll);
    expect(nAll, `${specId} has rows`).toBeGreaterThan(0);
    await expectDataSchemaWorks(page, handleRef);

    if (specId === 'weather') {
      await expectVgplotIntervalActionWorks(page, graph, handleRef, nAll);
    }
  }
});

test('examples: vega-lite-gallery', async ({ page }) => {
  await gotoApp(page, 'vega-lite-gallery');

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
  }
});

/**
 * Wait until the published ref scripts hold the bridge's current state at the manifest's revision. A live
 * read writes its snapshot before it resolves, so the scripts are read right after it in the same task.
 */
async function settledDomSnapshot(page: Page, previousRevision?: string): Promise<{ revision: string; state: any }> {
  let settled = { revision: '', state: {} as Record<string, unknown>, current: false };
  await expect
    .poll(async () => {
      settled = await page.evaluate(async () => {
        const canonical = (value: unknown): string =>
          JSON.stringify(value, (_key, item) =>
            item && typeof item === 'object' && !Array.isArray(item)
              ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => (left < right ? -1 : 1)))
              : item,
          );
        const state = (await globalThis.__vacp.observe()).state as Record<string, unknown>;
        const read = (id: string) => JSON.parse(document.getElementById(id)!.textContent!);
        const manifest = read('__vacp_snapshot');
        const index = read(manifest.state.indexScriptId);
        const catalog = read(manifest.state.catalogScriptId);
        const published = new Map<string, unknown>(
          catalog.refs.map((entry: { ref: string; scriptId: string }) => [entry.ref, read(entry.scriptId).value]),
        );
        return {
          revision: manifest.observation.revision as string,
          state: JSON.parse(JSON.stringify(state)),
          current:
            index.revision === manifest.observation.revision &&
            published.size === Object.keys(state).length &&
            Object.entries(state).every(([ref, value]) => canonical(published.get(ref)) === canonical(value)),
        };
      });
      return settled.current && settled.revision !== previousRevision;
    })
    .toBe(true);
  return settled;
}

test('examples: the DOM snapshot advances by observation revision and rewrites only changed refs', async ({ page }) => {
  await gotoApp(page, 'react-dashboard');
  expect((await executeVacp(page, { name: 'dashboard.set_dataset', params: { id: 'iris' } })).ok).toBe(true);
  await page.waitForFunction(() => document.querySelector('script[data-vacp="snapshot-ref"]'));
  const before = await settledDomSnapshot(page);

  // Each write replaces a script's text node, so the added node keeps the text of that write. The chain
  // starts at the index the observer first sees, read in the same task that installs it.
  const base = await page.evaluate(() => {
    const read = (id: string) => JSON.parse(document.getElementById(id)!.textContent!);
    const indexId = read('__vacp_snapshot').state.indexScriptId;
    const writes: { indexes: any[]; rewritten: string[] } = { indexes: [], rewritten: [] };
    new MutationObserver((records) => {
      for (const record of records) {
        const script = record.target as Element;
        const text = record.addedNodes[0]?.textContent;
        if (script.id === indexId && text) writes.indexes.push(JSON.parse(text));
        const ref = script.getAttribute('data-vacp-ref');
        if (ref && text) writes.rewritten.push(ref);
      }
    }).observe(document.head, { childList: true, subtree: true });
    Object.assign(globalThis, { __snapshotWrites: writes });
    return read(indexId).revision as string;
  });

  const encoding = { x: 'PetalWidthCm', y: 'SepalWidthCm', color: 'Species' };
  expect((await executeVacp(page, { name: 'dashboard.set_encoding', params: encoding })).ok).toBe(true);
  const after = await settledDomSnapshot(page, before.revision);
  const changed = Object.keys(after.state).filter(
    (ref) => JSON.stringify(after.state[ref]) !== JSON.stringify(before.state[ref]),
  );
  expect(changed.length).toBeGreaterThan(0);

  const { writes, revision: latest } = await page.evaluate(() => ({
    writes: (globalThis as any).__snapshotWrites,
    revision: JSON.parse(
      document.getElementById(JSON.parse(document.getElementById('__vacp_snapshot')!.textContent!).state.indexScriptId)!
        .textContent!,
    ).revision as string,
  }));
  let revision = base;
  const listed = new Set<string>();
  for (const index of writes.indexes) {
    expect(index.baseRevision).toBe(revision);
    revision = index.revision;
    for (const ref of index.changedRefs) listed.add(ref);
  }
  expect(revision).toBe(latest);
  for (const ref of changed) expect(listed).toContain(ref);
  for (const ref of writes.rewritten) expect(listed).toContain(ref);
  expect(listed.size).toBeLessThan(Object.keys(after.state).length);
});

test('examples: react-dashboard', async ({ page }) => {
  await gotoApp(page, 'react-dashboard');

  expect((await executeVacp(page, { name: 'dashboard.set_dataset', params: { id: 'iris' } })).ok).toBe(true);
  expect(
    (
      await executeVacp(page, {
        name: 'dashboard.set_encoding',
        params: { x: 'SepalLengthCm', y: 'PetalLengthCm', color: 'Species' },
      })
    ).ok,
  ).toBe(true);

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

  const rtBefore = await getProvenance(page);
  const beforeHist = (rtBefore.records ?? []).length;

  await page.locator('svg circle[data-point-id]').first().click({ force: true });
  await waitForHistoryLenAtLeast(page, beforeHist + 1);

  const resSel = await dataSql(page, { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' });
  expect(resSel.ok).toBeTruthy();
  const nSel = countFromResult(resSel);
  expect(nSel).toBe(1);
});
