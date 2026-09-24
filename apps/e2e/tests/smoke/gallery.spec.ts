import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { appReady, appServer } from '../helpers/servers';
import { tool } from '../helpers/presence';

// WebMCP flags are worker options and apply to every test in this file.
test.use({
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

const server = appServer('gallery-build');

for (const route of ['athletes', 'vgplot', 'vega-lite', 'react-dashboard', 'cars-parcoords']) {
  test(`built gallery serves ${route} with its semantic bridge`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.locator(`a[href="./${route}/"], a[href="${route}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${route}/$`));
    await expect(page.locator('#gallery-example-mount')).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const bridge = window.__vacp;

            if (!bridge) return 0;
            const capabilities = await bridge.getCapabilities();

            return capabilities.graph.nodes.length;
          }),
        appReady,
      )
      .toBeGreaterThan(0);
    const state = await page.evaluate(async () => {
      if (!window.__vacp) throw new Error('Missing VACP bridge');
      return window.__vacp.getState();
    });
    expect(state.state).toBeDefined();
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
  expect((await tool(page, 'vgplot.set_interval_1d', { plotId: 'age', interactorId: '0', min: 22, max: 28 })).ok).toBe(
    true,
  );
  const bubble = page.locator('[data-vacp-bubble]');
  // The finished step stays on screen as a request of its own until the person dismisses it.
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
