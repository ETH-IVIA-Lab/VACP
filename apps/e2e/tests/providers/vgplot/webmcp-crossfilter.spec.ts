import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { exampleDir } from '../../helpers/paths';
import { startAppServer } from '../../helpers/devserver';

test.use({
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

async function execute(page: Page, suffix: string, params: unknown = {}) {
  return page.evaluate(
    async ({ suffix, params }) => {
      const context = document.modelContext!;
      const tool = (await context.getTools()).find((tool) => tool.name.endsWith(suffix));
      if (!tool) throw new Error(`Missing WebMCP tool: ${suffix}`);
      return JSON.parse(await context.executeTool(tool, JSON.stringify(params)));
    },
    { suffix, params },
  );
}

async function rasters(page: Page) {
  const images = await page
    .locator('#app image')
    .evaluateAll((images) => images.map((image) => image.getAttribute('href')!));
  return images.map((image) => createHash('sha256').update(image).digest('hex'));
}

test('WebMCP taxi brushes update linked rasters, preserve context, and accept either corner order', async ({
  page,
}) => {
  const server = await startAppServer({ name: 'vgplot-webmcp', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${server.url}#nyc-taxi-rides`);
    await expect
      .poll(
        () =>
          page.evaluate(
            async () =>
              (await document.modelContext?.getTools())?.some((tool) => tool.name === 'vacp.observe') ?? false,
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(page.locator('#app image')).toHaveCount(2);
    const before = await rasters(page);
    const histogram = page.locator('#app svg').nth(2).locator('[aria-label="rect"]');
    const bars = await histogram.innerHTML();

    // Replay discovery and SQL before the action, as a browser agent does.
    await execute(page, 'vacp.observe');
    const query = await execute(page, 'vacp.data_sql', {
      handleRef: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/data/main',
      sql: 'SELECT floor(px/2500)*2500 AS px_bin, floor(py/2500)*2500 AS py_bin, count(*) AS n FROM vacp_all GROUP BY 1, 2 ORDER BY n DESC LIMIT 10',
    });
    expect(query.ok).toBe(true);
    const target = { plotId: 'plot-0', interactorId: '0' };
    const region = { ...target, x0: 982500, x1: 997500, y0: 202500, y1: 227500 };
    expect((await execute(page, 'vgplot.set_interval_2d', region)).ok).toBe(true);
    await expect.poll(async () => (await rasters(page))[1]).not.toBe(before[1]);
    const selected = await rasters(page);
    // Crossfilter excludes its source. This example's histogram does not subscribe to the filter.
    expect(selected[0]).toBe(before[0]);
    expect(await histogram.innerHTML()).toBe(bars);
    await expect(page.locator('#app .interval-xy rect.selection').first()).toBeVisible();

    expect(
      (
        await execute(page, 'vgplot.set_interval_2d', {
          ...target,
          x0: region.x1,
          x1: region.x0,
          y0: region.y1,
          y1: region.y0,
        })
      ).ok,
    ).toBe(true);
    // A subsequent SQL read lets the native query queue drain before comparing rendered output.
    const rows = await execute(page, 'vacp.data_sql', {
      handleRef: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/data/main',
      sql: 'SELECT count(*)::INTEGER AS n FROM vacp_handle',
    });
    expect(rows.result.rows[0].n).toBeGreaterThan(0);
    await expect.poll(() => rasters(page)).toEqual(selected);

    expect((await execute(page, 'vgplot.clear_interval_2d', target)).ok).toBe(true);
    await expect.poll(() => rasters(page)).toEqual(before);
    expect(
      (
        await execute(page, 'vgplot.set_interval_1d', {
          plotId: 'plot-2',
          interactorId: '0',
          min: 5,
          max: 7,
        })
      ).ok,
    ).toBe(true);
    await expect.poll(async () => (await rasters(page)).every((image, i) => image !== before[i])).toBe(true);
    expect((await execute(page, 'vgplot.clear_interval_1d', { plotId: 'plot-2', interactorId: '0' })).ok).toBe(true);
    await expect.poll(() => rasters(page)).toEqual(before);
  } finally {
    await server.stop();
  }
});
