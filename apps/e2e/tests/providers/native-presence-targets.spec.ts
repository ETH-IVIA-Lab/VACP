import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';
import { executeOperation } from './operations';

test('Vega view replacement preserves native bound controls and mark-specific presence', async ({ page }) => {
  const server = appServer('vega-lite-gallery');
  await page.goto(`${server.url}#global-development`);
  await expect(page.locator('input[name=current_year]')).toBeVisible();
  await page.locator('#spec').selectOption('airports');
  await page.waitForFunction(() => globalThis.__vacp?.sessionKey === 'vega-lite/airports');
  const ref = await page.evaluate(
    async () => (await globalThis.__vacp.observe()).graph.nodes.find((node) => node.ref.endsWith('/param/org'))!.ref,
  );
  expect((await executeOperation(page, 'vega_lite.set_selection', { ref, value: { origin: 'SEA' } }))?.ok).toBe(true);
  await expect(page.locator('[data-vacp-presence] path[data-precision]')).toHaveAttribute('data-precision', 'exact');
  const bounds = await page.locator('[data-vacp-presence] path[data-precision]').boundingBox();
  expect(bounds!.width).toBeLessThan(80);
  await page.locator('#spec').selectOption('global-development');
  await page.waitForFunction(() => globalThis.__vacp?.sessionKey === 'vega-lite/global-development');
  const year = await page.evaluate(
    async () =>
      (await globalThis.__vacp.observe()).graph.nodes.find((node) => node.ref.endsWith('/param/current_year'))!.ref,
  );
  expect((await executeOperation(page, 'vega_lite.set_param', { ref: year, value: 2005 }))?.ok).toBe(true);
  await page.setViewportSize({ width: 1100, height: 750 });
  await expect(page.locator('input[name=current_year]')).toHaveValue('2005');
  await expect(page.locator('[data-vacp-presence] path[data-precision]')).toHaveAttribute('data-precision', 'exact');
});

test('Mosaic table actions update native rows, sort indicators, and page state once', async ({ page }) => {
  const server = appServer('vgplot-gallery');
  await page.goto(`${server.url}#table`);
  await page.waitForFunction(() => globalThis.__vacp?.sessionKey === 'vgplot/table');
  await expect(page.locator('#app tbody tr')).toHaveCount(100);
  for (const column of ['delay', 'distance']) {
    expect(
      (await executeOperation(page, 'vgplot.table_set_sort', { tableId: 'table-0', column, desc: true }))?.ok,
    ).toBe(true);
    await expect(page.locator('#app th').filter({ hasText: column })).toContainText('▾');
    await expect(page.locator('#app tbody tr')).toHaveCount(100);
    await expect(page.locator('[data-vacp-presence] path[data-precision]')).toHaveAttribute('data-precision', 'exact');
  }
  const previous = await page.locator('#app tbody tr').first().textContent();
  expect(
    (await executeOperation(page, 'vgplot.table_set_page', { tableId: 'table-0', offset: 100, limit: 25 }))?.ok,
  ).toBe(true);
  await expect(page.locator('#app tbody tr')).toHaveCount(25);
  expect(await page.locator('#app tbody tr').first().textContent()).not.toBe(previous);
  const state = await page.evaluate(async () =>
    Object.values((await globalThis.__vacp.observe()).state).find(
      (value) => value && typeof value === 'object' && 'kind' in value && value.kind === 'Table',
    ),
  );
  expect(state).toMatchObject({ offset: 100, limit: 25 });
  const rows = await page.locator('#app tbody').textContent();
  expect(
    (await executeOperation(page, 'vgplot.table_set_sort', { tableId: 'table-0', column: 'missing-column' }))?.ok,
  ).toBe(false);
  expect(await page.locator('#app tbody').textContent()).toBe(rows);
});

test('linked Mosaic legends expose their shared visible selection and exact entry targets', async ({ page }) => {
  const server = appServer('vgplot-gallery');
  await page.goto(`${server.url}#legends`);
  await page.waitForFunction(() => globalThis.__vacp?.sessionKey === 'vgplot/legends');
  expect(
    (await executeOperation(page, 'vgplot.set_legend_toggle', { plotId: 'plot-0', channel: 'color', value: 'bar' }))
      ?.ok,
  ).toBe(true);
  await expect(page.locator('[data-vacp-presence] path[data-precision]')).toHaveAttribute('data-precision', 'exact');
  const state = await page.evaluate(async () =>
    Object.entries((await globalThis.__vacp.observe()).state)
      .filter(([ref]) => ref.includes('/plot-0/legend/'))
      .map(([, value]) => value),
  );
  expect(state).toEqual([expect.objectContaining({ value: [['bar']] }), expect.objectContaining({ value: [['bar']] })]);
  const saved = await page.evaluate(async () =>
    Object.fromEntries(
      Object.entries((await globalThis.__vacp.observe()).state).filter(([ref]) => ref.includes('/plot-0/legend/')),
    ),
  );
  await executeOperation(page, 'vgplot.set_legend_toggle', { plotId: 'plot-0', channel: 'color', value: 'baz' });
  expect((await executeOperation(page, 'vacp.apply_state', { state: saved }))?.ok).toBe(true);
  const visible = await page.evaluate(() =>
    [...document.querySelectorAll('.legend')]
      .slice(0, 2)
      .map((legend) =>
        [...legend.querySelectorAll<HTMLElement & { __data__?: unknown }>('*')].flatMap((element) =>
          element.__data__ === 'bar' || element.__data__ === 'foo'
            ? [{ value: element.__data__, opacity: getComputedStyle(element).opacity }]
            : [],
        ),
      ),
  );
  for (const values of visible)
    expect(values).toEqual(
      expect.arrayContaining([
        { value: 'bar', opacity: '1' },
        { value: 'foo', opacity: '0.2' },
      ]),
    );
});
