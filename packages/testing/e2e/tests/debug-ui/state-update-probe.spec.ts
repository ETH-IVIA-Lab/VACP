import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { dispatchSwappedDimensionOrder, waitForVacpBridge } from './helpers';

test('debug-ui: state update probe surfaces full and delta summaries', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const jsonTab = page.getByRole('tab', { name: 'JSON' });
    await expect(jsonTab).toBeVisible();
    await jsonTab.click();

    const panel = page.locator('[data-vacp-state-update="panel"]');
    await expect(panel).toBeVisible();
    await panel.locator('summary', { hasText: 'Update probe' }).click();

    const seedSince = page.locator('button[aria-label="Seed since from full"]');
    await expect(seedSince).toBeVisible();
    await seedSince.click();

    const sinceInput = page.locator('[data-vacp-state-update="since"]');
    await expect.poll(async () => await sinceInput.inputValue()).toMatch(/^st_[a-f0-9]+$/);
    await expect(page.locator('[data-vacp-state-update="summary"]')).toContainText(/mode[:=]\s*full/i);

    await dispatchSwappedDimensionOrder(page, 'state update probe delta check');

    await page.selectOption('[data-vacp-state-update="mode"]', 'delta');
    await page.locator('button[aria-label="Request update"]').click();

    const summary = page.locator('[data-vacp-state-update="summary"]');
    await expect(summary).toContainText(/mode[:=]\s*delta/i);
    const text = await summary.innerText();
    const changed = Number(text.match(/changed[:=]\s*(\d+)/i)?.[1] ?? '0');
    expect(changed).toBeGreaterThan(0);
  } finally {
    await srv.stop();
  }
});
