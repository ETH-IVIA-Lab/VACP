import { expect, type Page } from '@playwright/test';
import { test } from '../../helpers/test';

import { gotoApp } from '../../helpers/servers';
import { executeOperation, operationNames } from '../operations';

test('vgplot: set_interval_1d triggers downstream crossfilters (Seattle Weather)', async ({ page }) => {
  await gotoApp(page, 'vgplot-gallery', '#weather');

  const beforeRows = await selectedAndAllRowCounts(page);
  expect(beforeRows.selected).toBe(beforeRows.all);
  expect(beforeRows.all).toBeGreaterThan(0);
  const linkedBars = page.locator('#app [aria-label="bar"][data-index="1"] rect');
  const barWidths = () => linkedBars.evaluateAll((bars) => bars.map((bar) => Number(bar.getAttribute('width'))));
  const beforeWidths = await barWidths();
  expect(beforeWidths.length).toBeGreaterThan(0);

  // Programmatic brush (June-Aug) on the scatter plot should change the bottom bar chart.
  const res = await executeOperation(page, 'vgplot.set_interval_1d', {
    ref: 'vacp://vacp-examples/vgplot/weather/plot-0/interactor/0',
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
  await expect.poll(barWidths).not.toEqual(beforeWidths);
  expect((await barWidths()).some((width, i) => width > 0 && width < beforeWidths[i]!)).toBe(true);

  // Ensure the brush rect renders. Visual geometry is checked in the browser, not by snapshotting SVG markup.
  await page.waitForFunction(() => {
    const app = document.querySelector('#app');
    const svg = app?.querySelector('svg');
    const r = svg?.querySelector('rect.selection') as SVGRectElement | null;

    if (!r) return false;
    const b = r.getBBox();

    return b.width > 1 && b.height > 1;
  });
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

    const selected = await vacp.execute({
      name: names['vacp.data_sql'],
      params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle' },
    });

    const all = await vacp.execute({
      name: names['vacp.data_sql'],
      params: { handleRef, sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' },
    });

    return {
      selected: selected?.result?.rows?.[0]?.n,
      all: all?.result?.rows?.[0]?.n,
    };
  }, names);
}
