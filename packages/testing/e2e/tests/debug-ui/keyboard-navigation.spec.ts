import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { dispatchDimensionOrderPair, waitForVacpBridge } from './helpers';

test('debug-ui: keyboard navigation (compact module nav + roving focus)', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    await dispatchDimensionOrderPair(page);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const graphTab = page.getByRole('tab', { name: 'Graph' });
    const dataTab = page.getByRole('tab', { name: 'Data' });
    await expect(graphTab).toBeVisible();

    // Ensure the icon nav exposes named tabs and supports horizontal keyboard activation.
    await graphTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(dataTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dataTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Data' })).toBeVisible();

    // History list should support roving focus via ArrowUp/ArrowDown.
    const historyTab = page.getByRole('tab', { name: 'History' });
    await historyTab.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-vacp-row="history-entry"]').length >= 2);

    const firstRow = page.locator('[data-vacp-row="history-entry"]').first();
    const secondRow = page.locator('[data-vacp-row="history-entry"]').nth(1);
    await firstRow.focus();
    await expect(firstRow).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(secondRow).toBeFocused();
  } finally {
    await srv.stop();
  }
});
