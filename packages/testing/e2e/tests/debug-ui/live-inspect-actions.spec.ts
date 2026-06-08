import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { dimensionOrder, waitForVacpBridge } from './helpers';

async function waitForMode(page: Page, mode: 'live' | 'inspect'): Promise<void> {
  await page.waitForFunction(async (expected) => {
    const runtime = await (globalThis as any).__vacp?.getRuntime?.();
    return runtime?.mode === expected;
  }, mode);
}

test('debug-ui: running an action while inspecting returns to live mode', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const baseOrder = await dimensionOrder(page);
    expect(baseOrder.length).toBeGreaterThanOrEqual(2);
    const nextOrder = [baseOrder[1], baseOrder[0], ...baseOrder.slice(2)];

    await page.evaluate(async () => {
      const bridge = (globalThis as any).__vacp;
      await bridge.refresh({ source: 'debug', message: 'seed-0' });
      await bridge.refresh({ source: 'debug', message: 'seed-1' });
    });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Toggle live/inspect mode' }).click();
    await waitForMode(page, 'inspect');

    await page.getByRole('tab', { name: 'Actions' }).click();
    await page.getByRole('button', { name: /parallel_coords\.set_dimension_order/ }).click();
    const paramsEditor = page.locator('[data-vacp-json-editor="vacp-action-params"]');
    const rawParams = paramsEditor.locator('[data-vacp-json-editor-raw="vacp-action-params"]');
    await paramsEditor.getByRole('button', { name: 'Raw' }).click();
    await rawParams.fill('"scalar-param"');
    await expect(paramsEditor.locator('.vacp-json-editor-error')).toHaveCount(0);
    await rawParams.fill('{ "order": ');
    await expect(paramsEditor.locator('.vacp-json-editor-error')).toContainText('Unexpected end of JSON input');
    await page.getByRole('button', { name: 'Run action' }).click();
    await expect(page.getByText(/Invalid JSON params/)).toBeVisible();

    await page.getByRole('button', { name: /parallel_coords\.reset_brushes/ }).click();
    await expect(rawParams).toHaveValue('{}');
    await expect(paramsEditor.locator('.vacp-json-editor-error')).toHaveCount(0);

    await page.getByRole('button', { name: /parallel_coords\.set_dimension_order/ }).click();
    await expect(rawParams).toHaveValue('{}');
    await rawParams.fill(JSON.stringify({ order: nextOrder }, null, 2));
    await expect(paramsEditor.locator('.vacp-json-editor-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Run action' }).click();

    await waitForMode(page, 'live');
    await expect.poll(async () => await dimensionOrder(page)).toEqual(nextOrder);
  } finally {
    await srv.stop();
  }
});
