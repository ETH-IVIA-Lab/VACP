import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';
import { tool } from '../helpers/presence';

test.use({
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});
const cohortRef = 'vacp://vacp-examples/athletes/cohort';
const bodyRef = 'vacp://vacp-examples/athletes/physique/param/body';
const handleRef = 'vacp://vacp-examples/athletes/data/main';
async function count(page: Page, where: string) {
  const result = await tool(page, 'vacp.data_sql', {
    handleRef,
    sql: `SELECT count(*)::INTEGER AS n FROM vacp_all WHERE ${where}`,
  });
  expect(result.ok).toBe(true);
  return result.result.rows[0].n as number;
}
async function histogramTotal(page: Page) {
  return page.locator('[data-view="age"]').evaluate((root) => {
    const host = root.firstElementChild as HTMLElement & {
      value: { marks: Array<{ data: { columns: { y: number[] } } }> };
    };
    return Array.from(host.value.marks[0]!.data.columns.y).reduce((a, b) => Number(a) + Number(b), 0);
  });
}
async function expectCount(page: Page, expected: number) {
  await expect(page.locator('.athlete-summary strong').first()).toHaveText(expected.toLocaleString('en-US'));
  await expect.poll(async () => (await tool(page, 'vacp.state')).state[cohortRef].count).toBe(expected);
}

/** Page the native sports list to a row; selection must survive paging. */
async function sportRow(page: Page, sport: string) {
  const row = page.locator(`[data-sport="${sport}"]`);
  const previous = page.getByRole('button', { name: 'Previous sports', exact: true });
  const next = page.getByRole('button', { name: 'Next sports', exact: true });
  while (!(await row.count()) && (await previous.isEnabled())) await previous.click();
  while (!(await row.count()) && (await next.isEnabled())) await next.click();
  return row;
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const selectors = [
      '.athlete-summary strong',
      '[data-view="body"]',
      '[data-view="age"]',
      '#sports-title',
      '#roster-title',
      '.athlete-roster th',
    ];
    const frames = selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x + scrollX, box.y + scrollY, box.width, box.height].map((value) => Math.round(value));
      }),
    );
    const scrollers = Array.from(
      document.querySelectorAll('.gallery-route, .gallery-route__content, .athlete-explorer *'),
    ).flatMap((element) =>
      /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight
        ? [element.className]
        : [],
    );
    return { frames, scrollers };
  });
}

test('three providers compose one live athlete cohort across native views and WebMCP', async ({ page }, testInfo) => {
  const server = appServer('gallery');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.url}athletes/`);
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.length ?? 0), { timeout: 45000 })
    .toBeGreaterThan(10);
  const observation = await tool(page, 'vacp.observe');
  expect(observation.graph.sources.map((source: { type: string }) => source.type).sort()).toEqual([
    'cohort',
    'vega-lite',
    'vgplot',
  ]);
  expect(observation.graph.nodes.filter((node: { kind: string }) => node.kind === 'DataHandle')).toHaveLength(1);
  expect(new Set(observation.graph.nodes.map((node: { ref: string }) => node.ref)).size).toBe(
    observation.graph.nodes.length,
  );
  await expectCount(page, 11538);
  await expect.poll(() => histogramTotal(page)).toBe(11538);
  const canvas = page.locator('[data-view="body"] canvas');
  const before = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await sportRow(page, 'rowing');
  const sportOrder = await page
    .locator('[data-sport]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-sport')));
  const layoutBefore = await layout(page);
  expect(layoutBefore.scrollers).toEqual([]);
  await (await sportRow(page, 'rowing')).click();
  await expectCount(page, 547);
  await expect.poll(() => histogramTotal(page)).toBe(547);
  await expect.poll(() => canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(before);

  await (await sportRow(page, 'handball')).click({ modifiers: ['Meta'] });
  await expectCount(page, 910);
  await expect.poll(() => histogramTotal(page)).toBe(910);
  await expect(await sportRow(page, 'handball')).toHaveAttribute('aria-pressed', 'true');
  await expect(await sportRow(page, 'rowing')).toHaveAttribute('aria-pressed', 'true');
  await (await sportRow(page, 'handball')).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expectCount(page, 547);
  await (await sportRow(page, 'archery')).click({ modifiers: ['Meta'] });
  await expectCount(page, 675);
  await expect(await sportRow(page, 'rowing')).toHaveAttribute('aria-pressed', 'true');
  await (await sportRow(page, 'rowing')).click();
  await expectCount(page, 547);
  expect((await tool(page, 'cohort.set_sports', { sports: ['rowing', 'canoe'] })).ok).toBe(true);
  await expectCount(page, 878);
  await expect.poll(() => histogramTotal(page)).toBe(878);
  expect((await tool(page, 'cohort.set_sports', { sports: ['rowing'] })).ok).toBe(true);
  await expectCount(page, 547);

  expect(
    (await tool(page, 'vega_lite.set_selection', { ref: bodyRef, value: { x: [65.5, 90.5], y: [1.705, 1.955] } })).ok,
  ).toBe(true);
  const bodyWhere = 'weight BETWEEN 65.5 AND 90.5 AND height BETWEEN 1.705 AND 1.955';
  const bodyCount = await count(page, `sport = 'rowing' AND ${bodyWhere}`);
  await expectCount(page, bodyCount);
  await expect.poll(() => histogramTotal(page)).toBe(bodyCount);
  expect((await tool(page, 'vgplot.set_interval_1d', { plotId: 'age', interactorId: '0', min: 22, max: 28 })).ok).toBe(
    true,
  );
  const selected = await count(page, `sport = 'rowing' AND age BETWEEN 22 AND 28 AND ${bodyWhere}`);
  await expectCount(page, selected);
  expect(selected).toBeLessThan(bodyCount);
  expect((await tool(page, 'cohort.set_sex', { sex: 'female' })).ok).toBe(true);
  const female = await count(page, `sport = 'rowing' AND sex = 'female' AND age BETWEEN 22 AND 28 AND ${bodyWhere}`);
  await expectCount(page, female);
  await expect(page.getByRole('combobox', { name: 'Sex' })).toHaveValue('female');
  const state = (await tool(page, 'vacp.state')).state[cohortRef];
  expect(state.age).toEqual([22, 28]);
  expect(state.body).not.toBeNull();
  const data = await tool(page, 'vacp.data_sql', {
    handleRef,
    sql: 'SELECT count(*)::INTEGER AS n FROM vacp_handle',
  });
  expect(data.result.rows[0].n).toBe(female);
  await expect(page.locator('.athlete-roster tbody tr[data-athlete-id]')).toHaveCount(Math.min(female, 8));
  expect(
    await page.locator('[data-sport]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-sport'))),
  ).toEqual(sportOrder);
  expect(await layout(page)).toEqual(layoutBefore);
  await page.getByRole('button', { name: 'Next athletes', exact: true }).click();
  await expect(page.locator('[data-roster-pages] span')).toContainText('9–');
  await page.getByRole('button', { name: 'Previous athletes', exact: true }).click();

  // Human brushing remains live after actions from the other providers.
  const overlay = page.locator('[data-view="age"] rect.overlay');
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
  if (!box) throw new Error('Missing native age brush');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await tool(page, 'vacp.state')).state[cohortRef].age).not.toEqual([22, 28]);
  await page.screenshot({ path: testInfo.outputPath('composed.png'), fullPage: true });
  expect(
    (await tool(page, 'vega_lite.set_selection', { ref: bodyRef, value: { x: [31.1, 31.9], y: [2.1, 2.15] } })).ok,
  ).toBe(true);
  await expectCount(page, 0);
  expect(await layout(page)).toEqual(layoutBefore);
  await expect(page.locator('[data-empty]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  await expect(page.locator('.athlete-error')).toBeHidden();
});

test('unmount releases the composed runtime, native charts and owned database worker', async ({ page }) => {
  const server = appServer('athlete-explorer');
  await page.route('**/src/main.ts', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(async () => {
      const modulePath = '/src/mfe.ts';
      const { mount } = await import(modulePath);
      const dispose = await mount(document.querySelector('#athletes-root')!);
      if (!window.__vacp) throw new Error('Missing composed bridge');
      await dispose();
      await dispose();
    });
    expect(await page.evaluate(() => !!window.__vacp)).toBe(false);
    await expect(page.locator('.athlete-explorer')).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(0);
    expect(await page.evaluate(async () => (await document.modelContext!.getTools()).length)).toBe(0);
  }
});

test('the gallery dashboard fits a 16-inch MacBook Pro viewport without scrolling', async ({ page }, testInfo) => {
  const server = appServer('gallery');
  await page.setViewportSize({ width: 1728, height: 960 });
  await page.goto(new URL('athletes/', server.url).href);
  await page.waitForFunction(
    () => !!document.querySelector('[data-view="age"] svg') && !!document.querySelector('[data-view="body"] canvas'),
  );
  const fit = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    viewport: innerHeight,
    dashboard: document.querySelector('.athlete-details')!.getBoundingClientRect().bottom,
  }));
  expect(fit.document).toBeLessThanOrEqual(fit.viewport);
  expect(fit.dashboard).toBeLessThanOrEqual(fit.viewport);
  await page.screenshot({ path: testInfo.outputPath('gallery-athletes-1728x960.png') });
});
