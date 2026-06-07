import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

test('debug-ui: SQL editor keeps focus on run', async ({ page }) => {
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
    await expect(page.locator('.vacp-debug-ui-meta')).toContainText('mode=', { timeout: 15_000 });

    const dataTab = page.getByRole('tab', { name: 'Data' });
    await expect(dataTab).toBeVisible();
    await dataTab.click();

    const editor = page.locator('[data-vacp-focus="data-sql"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });

    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('SELECT 1::INTEGER AS x');
    await expect(editor).toBeFocused();

    const run = page.locator('button[aria-label="Run query"]');
    await expect(run).toBeVisible();
    await run.click();

    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset?.vacpFocus === 'data-sql');
    await expect(editor).toBeFocused();
    await expect(editor).toContainText('SELECT 1::INTEGER AS x');
  } finally {
    await srv.stop();
  }
});
