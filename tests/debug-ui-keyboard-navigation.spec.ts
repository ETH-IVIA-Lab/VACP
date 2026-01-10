import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('debug-ui: keyboard navigation (tabs + roving focus)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vanilla-minimal', cwd: resolve(examplesDir, 'vanilla-minimal') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    // Create a few history entries with state.
    await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;
      if (!b || typeof b.dispatch !== 'function') throw new Error('Missing bridge.dispatch');
      await b.dispatch(
        { callId: crypto.randomUUID(), name: 'vanilla.toggle_point', params: { id: 0 } },
        { source: 'debug', message: 'select 0' },
      );
      await b.dispatch(
        { callId: crypto.randomUUID(), name: 'vanilla.toggle_point', params: { id: 1 } },
        { source: 'debug', message: 'select 1' },
      );
    });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const graphTab = page.locator('.vacp-debug-ui-module', { hasText: 'Graph' });
    const dataTab = page.locator('.vacp-debug-ui-module', { hasText: 'Data' });
    await expect(graphTab).toBeVisible();

    // Ensure we can move focus with arrows (vertical tabs) and activate with Enter.
    await graphTab.focus();
    await page.keyboard.press('ArrowDown');
    await expect(dataTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dataTab).toHaveAttribute('data-state', 'active');

    // History list should support roving focus via ArrowUp/ArrowDown.
    const historyTab = page.locator('.vacp-debug-ui-module', { hasText: 'History' });
    await historyTab.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-vacp-row=\"history-entry\"]').length >= 2);

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
