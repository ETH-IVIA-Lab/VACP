import { expect, test } from '@playwright/test';
import { startAppServer, type DevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

let server: DevServer;

test.beforeAll(async () => {
  server = await startAppServer({ name: 'gallery-preview', cwd: exampleDir('gallery'), script: 'preview' });
});

test.afterAll(async () => {
  await server?.stop();
});

for (const route of ['athletes', 'vgplot', 'vega-lite', 'react-dashboard', 'cars-parcoords']) {
  test(`built gallery serves ${route} with its semantic bridge`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.locator(`a[href="./${route}/"], a[href="${route}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${route}/$`));
    await expect(page.locator('#gallery-example-mount')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const bridge = window.__vacp;

          if (!bridge) return 0;
          const capabilities = await bridge.getCapabilities();

          return capabilities.graph.nodes.length;
        }),
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
