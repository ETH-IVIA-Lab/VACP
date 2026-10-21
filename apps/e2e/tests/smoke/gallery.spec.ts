import { expect } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import { appReady, appServer } from '../helpers/servers';
import { tool } from '../helpers/presence';

useWebMcp();

const server = appServer('gallery-build');

// Each route's opening view, as a ref its graph publishes and, where the view has loaded data, that ref's state.
const opening = [
  {
    route: 'athletes',
    ref: 'vacp://vacp-examples/athletes/cohort',
    state: { sports: [], sex: 'all', count: 11538 },
  },
  {
    route: 'vgplot',
    ref: 'vacp://vacp-examples/vgplot/aeromagnetic-survey/data/main',
    state: { kind: 'DataHandle', rowCount: 4434 },
  },
  {
    route: 'vega-lite',
    ref: 'vacp://vacp-examples/vega-lite/airports/airports/data/main',
    state: { kind: 'DataHandle', rowCount: 3376 },
  },
  // The dashboard opens with no dataset, which leaves its view as the only node an agent sees.
  { route: 'react-dashboard', ref: 'vacp://vacp-examples/react/dashboard', state: undefined },
  {
    route: 'cars-parcoords',
    ref: 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords/selection/brushes',
    state: { selectedCount: 406, totalCount: 406 },
  },
] as const;

for (const { route, ref, state } of opening) {
  test(`built gallery serves ${route} with its semantic bridge`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.locator(`a[href="./${route}/"], a[href="${route}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${route}/$`));
    await expect(page.locator('#gallery-example-mount')).toBeVisible();
    const observe = () =>
      page.evaluate(async (ref) => {
        const bridge = window.__vacp;
        if (!bridge) return null;
        const { graph } = await bridge.getCapabilities();
        const { state } = await bridge.observe();
        return { published: graph.nodes.some((node) => node.ref === ref), state: state[ref] };
      }, ref);
    await expect.poll(async () => (await observe())?.published, appReady).toBe(true);
    const observed = await observe();
    if (state) expect(observed?.state).toMatchObject(state);
    else expect(observed?.state).toBeUndefined();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${route}.png`), fullPage: true });
  });
}

// Minified builds rename Mosaic classes, so these routes witness class-based discovery in production.
const interactive = [
  { route: 'athletes/', contracts: ['vgplot.set_interval_1d', 'vgplot.clear_interval_1d'] },
  { route: 'vgplot/#weather', contracts: ['vgplot.set_interval_1d', 'vgplot.set_toggle', 'vgplot.set_legend_toggle'] },
  { route: 'vgplot/#pan-zoom', contracts: ['vgplot.set_pan_zoom'] },
  { route: 'vgplot/#region-tests', contracts: ['vgplot.set_region'] },
  { route: 'vgplot/#facet-interval', contracts: ['vgplot.set_interval_2d'] },
] as const;

for (const { route, contracts } of interactive) {
  test(`built ${route} advertises its Mosaic interactions`, async ({ page }) => {
    await page.goto(new URL(route, server.url).href);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const graph = (await window.__vacp?.getCapabilities())?.graph;
            return graph ? graph.actions.map((action) => action.operation.contract) : [];
          }),
        appReady,
      )
      .toEqual(expect.arrayContaining([...contracts]));
  });
}

test('an agent brush in the built athletes route lands on the native Mosaic brush', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(new URL('athletes/', server.url).href);
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          ((await document.modelContext?.getTools()) ?? []).some((tool) =>
            tool.name.endsWith('vgplot.set_interval_1d'),
          ),
        ),
      appReady,
    )
    .toBe(true);
  expect(
    (
      await tool(page, 'vgplot.set_interval_1d', {
        ref: 'vacp://vacp-examples/athletes/age/interactor/0',
        min: 22,
        max: 28,
      })
    ).ok,
  ).toBe(true);
  expect((await tool(page, 'vacp.progress', { message: 'Ages 22 to 28 are selected.', done: true })).ok).toBe(true);
  const bubble = page.locator('[data-vacp-bubble]');
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Conclusion');
  // The request's recorded step outlines the native brush it left behind.
  await bubble.hover();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Step 1 of 1');
  const box = (selector: string, shadow: boolean) =>
    page.evaluate(
      ({ selector, shadow }) => {
        const root = shadow ? document.querySelector('[data-vacp-presence]')!.shadowRoot! : document;
        const element = [...root.querySelectorAll(selector)].find((node) =>
          shadow ? node.getAttribute('d') : node.getAttribute('width'),
        );
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
      },
      { selector, shadow },
    );
  await expect.poll(() => box('path[data-precision="exact"]', true)).not.toBeNull();
  const brush = await box('[data-view="age"] rect.selection', false);
  expect(brush).not.toBeNull();
  await expect.poll(() => box('path[data-precision="exact"]', true)).toEqual(brush);
});
