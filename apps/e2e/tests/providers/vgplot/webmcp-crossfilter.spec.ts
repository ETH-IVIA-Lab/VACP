import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test, useWebMcp } from '../../helpers/test';
import { appServer } from '../../helpers/servers';
import { tool } from '../../helpers/presence';

useWebMcp();

test('WebMCP time changes and reads preserve a human spatial brush with source-specific state', async ({ page }) => {
  const server = appServer('vgplot-gallery');
  await page.goto(`${server.url}#nyc-taxi-rides`);
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await document.modelContext?.getTools())?.some((tool) => tool.name === 'vacp.observe') ?? false,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
  const plots = page.locator('#app svg');
  const overlay = plots.nth(1).locator('rect.overlay');
  const box = await overlay.boundingBox();
  if (!box) throw new Error('Missing dropoff brush surface');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  const ref = (plot: number) => `vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-${plot}/interactor/0`;
  const manual = await plots.nth(1).evaluate((svg) => {
    const host = svg.parentElement as HTMLElement & { value: { interactors: Array<{ value: unknown }> } };
    return host.value.interactors[0]!.value;
  });
  expect(manual).toHaveLength(2);
  expect(Array.isArray(manual) && Array.isArray(manual[0])).toBe(true);
  expect(
    (
      await tool(page, 'vgplot.set_interval_1d', {
        ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-2/interactor/0',
        min: 20,
        max: 22,
      })
    ).ok,
  ).toBe(true);
  await expect
    .poll(async () => {
      const state = (await tool(page, 'vacp.state')).snapshot.state;
      return [0, 1, 2].map((index) => state[ref(index)].selectionValue);
    })
    .toEqual([null, manual, [20, 22]]);
  const observation = await tool(page, 'vacp.observe');
  expect(observation.state[ref(0)].selectionValue).toBeNull();
  expect(observation.state[ref(1)].selectionValue).toEqual(manual);
  expect(observation.state[ref(2)].selectionValue).toEqual([20, 22]);
  const handleRef = 'vacp://vacp-examples/vgplot/nyc-taxi-rides/data/main';
  await tool(page, 'vacp.data_schema', { handleRef });
  expect(
    (await tool(page, 'vacp.data_sql', { handleRef, sql: 'SELECT count(*)::INTEGER AS n FROM vacp_handle' })).ok,
  ).toBe(true);
  expect(
    (
      await tool(page, 'vgplot.clear_interval_2d', {
        ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-0/interactor/0',
      })
    ).ok,
  ).toBe(true);
  expect((await tool(page, 'vacp.state')).snapshot.state[ref(1)].selectionValue).toEqual(manual);
  await expect(plots.nth(1).locator('rect.selection')).toBeVisible();
  expect(
    (
      await tool(page, 'vgplot.clear_interval_2d', {
        ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-1/interactor/0',
      })
    ).ok,
  ).toBe(true);
  await expect(plots.nth(1).locator('rect.selection')).toBeHidden();
  expect((await tool(page, 'vacp.apply_state', { state: observation.state })).ok).toBe(true);
  await expect
    .poll(async () => {
      const state = (await tool(page, 'vacp.state')).snapshot.state;
      return [0, 1, 2].map((index) => state[ref(index)].selectionValue);
    })
    .toEqual([null, manual, [20, 22]]);
  await expect(plots.nth(1).locator('rect.selection')).toBeVisible();
});

async function rasters(page: Page) {
  const images = await page
    .locator('#app image')
    .evaluateAll((images) => images.map((image) => image.getAttribute('href')!));
  return images.map((image) => createHash('sha256').update(image).digest('hex'));
}

test('WebMCP taxi brushes update linked rasters, preserve context, and accept either corner order', async ({
  page,
}) => {
  const server = appServer('vgplot-gallery');
  await page.goto(`${server.url}#nyc-taxi-rides`);
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await document.modelContext?.getTools())?.some((tool) => tool.name === 'vacp.observe') ?? false,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
  await expect(page.locator('#app image')).toHaveCount(2);
  const before = await rasters(page);
  const histogram = page.locator('#app svg').nth(2).locator('[aria-label="rect"]');
  const bars = await histogram.innerHTML();

  // Replay discovery and SQL before the action, as a browser agent does.
  await tool(page, 'vacp.observe');
  const query = await tool(page, 'vacp.data_sql', {
    handleRef: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/data/main',
    sql: 'SELECT floor(px/2500)*2500 AS px_bin, floor(py/2500)*2500 AS py_bin, count(*) AS n FROM vacp_all GROUP BY 1, 2 ORDER BY n DESC LIMIT 10',
  });
  expect(query.ok).toBe(true);
  const target = { ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-0/interactor/0' };
  const region = { ...target, x0: 982500, x1: 997500, y0: 202500, y1: 227500 };
  expect((await tool(page, 'vgplot.set_interval_2d', region)).ok).toBe(true);
  await expect.poll(async () => (await rasters(page))[1]).not.toBe(before[1]);
  const selected = await rasters(page);
  // Crossfilter excludes its source. This example's histogram does not subscribe to the filter.
  expect(selected[0]).toBe(before[0]);
  expect(await histogram.innerHTML()).toBe(bars);
  await expect(page.locator('#app .interval-xy rect.selection').first()).toBeVisible();

  expect(
    (
      await tool(page, 'vgplot.set_interval_2d', {
        ...target,
        x0: region.x1,
        x1: region.x0,
        y0: region.y1,
        y1: region.y0,
      })
    ).ok,
  ).toBe(true);
  // A subsequent SQL read lets the native query queue drain before comparing rendered output.
  const rows = await tool(page, 'vacp.data_sql', {
    handleRef: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/data/main',
    sql: 'SELECT count(*)::INTEGER AS n FROM vacp_handle',
  });
  expect(rows.result.rows[0].n).toBeGreaterThan(0);
  await expect.poll(() => rasters(page)).toEqual(selected);

  expect((await tool(page, 'vgplot.clear_interval_2d', target)).ok).toBe(true);
  await expect.poll(() => rasters(page)).toEqual(before);
  expect(
    (
      await tool(page, 'vgplot.set_interval_1d', {
        ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-2/interactor/0',
        min: 5,
        max: 7,
      })
    ).ok,
  ).toBe(true);
  await expect.poll(async () => (await rasters(page)).every((image, i) => image !== before[i])).toBe(true);
  expect(
    (
      await tool(page, 'vgplot.clear_interval_1d', {
        ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-2/interactor/0',
      })
    ).ok,
  ).toBe(true);
  await expect.poll(() => rasters(page)).toEqual(before);
});
