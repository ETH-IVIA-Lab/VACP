import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

test('debug-ui: default overlay and settings browser overrides', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();

    const panel = page.locator('#vacp-debug-ui-panel');
    await expect(panel).toBeVisible();

    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.locator('.vacp-debug-ui-content')).toContainText('Feature flags');
    await expect(page.locator('.vacp-debug-ui-content')).toContainText('Debug overlay');
    await expect(page.locator('.vacp-debug-ui-content')).toContainText('Bridge exposure');
    await expect(page.locator('.vacp-debug-ui-content')).toContainText('DOM snapshot');
    await expect(page.locator('.vacp-debug-ui-content')).toContainText('Raw SQL action');

    await page.getByRole('switch', { name: 'Toggle Raw SQL action' }).click();
    await expect(page.locator('.vacp-debug-ui-settings-row', { hasText: 'Raw SQL action' })).toContainText('Browser');
    await expect(page.getByRole('button', { name: 'Reload' })).toBeEnabled();

    const stored = await page.evaluate(() => localStorage.getItem('vacp:enable-sql'));
    expect(stored).toBe('0');

    await page.getByRole('button', { name: 'Clear Raw SQL action browser override' }).click();
    const cleared = await page.evaluate(() => localStorage.getItem('vacp:enable-sql'));
    expect(cleared).toBeNull();
  } finally {
    await srv.stop();
  }
});
