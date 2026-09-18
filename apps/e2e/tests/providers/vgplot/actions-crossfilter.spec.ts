import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';
import { executeOperation, operationNames } from '../operations';

test('vgplot: set_interval_1d triggers downstream crossfilters (Seattle Weather)', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__vacp);

    const beforeRows = await selectedAndAllRowCounts(page);
    expect(beforeRows.selected).toBe(beforeRows.all);
    expect(beforeRows.all).toBeGreaterThan(0);

    // Programmatic brush (June-Aug) on the scatter plot should change the bottom bar chart.
    const res = await executeOperation(page, 'vgplot.set_interval_1d', {
      plotId: 'plot-0',
      interactorId: '0',
      min: 1338508800000,
      max: 1346457600000,
    });

    expect(res?.ok).toBeTruthy();

    await expect
      .poll(
        async () => {
          const rows = await selectedAndAllRowCounts(page);

          return rows.all === beforeRows.all && rows.selected > 0 && rows.selected < rows.all;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const afterRows = await selectedAndAllRowCounts(page);
    expect(afterRows.selected).toBeGreaterThan(0);
    expect(afterRows.selected).toBeLessThan(afterRows.all);
    expect(afterRows.selectionWhere).toMatch(/BETWEEN|>=|<=|date/i);

    // Ensure the brush rect renders. Visual geometry is checked in the browser, not by snapshotting SVG markup.
    await page.waitForFunction(() => {
      const app = document.querySelector('#app');
      const svg = app?.querySelector('svg');
      const r = svg?.querySelector('rect.selection') as SVGRectElement | null;

      if (!r) return false;
      const b = r.getBBox();

      return b.width > 1 && b.height > 1;
    });

    // Capture a post-action snapshot (includes the interval selection in domain units) and then
    // prove vacp.apply_state can restore it after changing the interval again.
    const names = await operationNames(page, ['vgplot.set_interval_1d', 'vacp.apply_state']);
    const restoreResult = await page.evaluate(async (names) => {
      const vacp = globalThis.__vacp;
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
        name: names['vgplot.set_interval_1d'],
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
        name: names['vacp.apply_state'],
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
    }, names);

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

async function selectedAndAllRowCounts(page: Page) {
  const names = await operationNames(page, ['vacp.data_sql']);
  return await page.evaluate(async (names) => {
    const vacp = globalThis.__vacp;
    const caps = await vacp.getCapabilities();

    const handleRef = caps?.graph?.nodes?.find(
      (node: any) => node?.kind === 'DataHandle' && String(node?.ref ?? '').includes('/vgplot/weather/'),
    )?.ref;

    if (!handleRef) throw new Error('Missing weather DataHandle');

    const state = await vacp.getState();
    const handleState = state?.state?.[handleRef] ?? {};

    const selected = await vacp.execute({
      callId: crypto.randomUUID(),
      name: names['vacp.data_sql'],
      params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' },
    });

    const all = await vacp.execute({
      callId: crypto.randomUUID(),
      name: names['vacp.data_sql'],
      params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' },
    });

    return {
      selected: selected?.result?.rows?.[0]?.n,
      all: all?.result?.rows?.[0]?.n,
      selectionWhere:
        typeof handleState === 'object' && handleState && typeof (handleState as any).selectionWhere === 'string'
          ? (handleState as any).selectionWhere
          : null,
    };
  }, names);
}
