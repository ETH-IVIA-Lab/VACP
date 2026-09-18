import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

async function openGraphTab(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-inspector-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-inspector-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Graph' }).click();
}

async function visibleNodeCount(page: Page): Promise<number> {
  return await page.locator('[data-vacp-graph-node-ref]').count();
}

test('inspector: Graph search kind filters and stable inspect pane work together', async ({ page }) => {
  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}#symbols`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });
    await openGraphTab(page);

    await expect(page.locator('[data-vacp-graph-controls="1"]')).toBeVisible();
    await expect(page.locator('[data-vacp-graph-layer-summary="1"]')).toContainText('Layer groups');
    await expect(page.locator('[data-vacp-graph-node-ref]').first()).toBeVisible({ timeout: 15_000 });
    const initialCount = await visibleNodeCount(page);
    expect(initialCount).toBeGreaterThan(8);

    await page.locator('[data-vacp-graph-search="1"]').fill('body_mass');
    await expect(page.locator('[data-vacp-graph-filter-summary="1"]')).toContainText(/Showing \d+ of \d+ nodes/);
    await expect.poll(async () => await visibleNodeCount(page)).toBeLessThan(initialCount);

    await page.locator('[data-vacp-graph-reset-filters="1"]').click();
    await page.locator('[data-vacp-graph-kind-filter="DataHandle"]').click();
    await expect.poll(async () => await visibleNodeCount(page)).toBeGreaterThan(0);
    await expect(page.locator('[data-vacp-graph-node-kind]:not([data-vacp-graph-node-kind="DataHandle"])')).toHaveCount(
      0,
    );

    const dataNode = page.locator('[data-vacp-graph-node-kind="DataHandle"]').first();
    const dataRef = await dataNode.getAttribute('data-vacp-graph-node-ref');

    if (!dataRef) throw new Error('Missing DataHandle ref');
    await dataNode.click();
    await expect(page.getByText(dataRef)).toBeVisible();

    await page.locator('[data-vacp-graph-search="1"]').fill('no-such-node');
    await expect(page.locator('[data-vacp-graph-filter-summary="1"]')).toContainText('Showing 0 of');
    await expect(page.getByText(dataRef)).toBeVisible();
  } finally {
    await srv.stop();
  }
});
