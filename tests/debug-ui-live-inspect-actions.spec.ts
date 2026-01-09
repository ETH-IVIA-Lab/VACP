import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('debug-ui: running playbook while inspecting returns to live mode', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    // Ensure the runtime has history so inspect mode has a cursor to land on.
    await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;
      await b.refresh({ source: 'debug', message: 'seed-0' });
      await b.refresh({ source: 'debug', message: 'seed-1' });
    });

    await page.locator('#vacp-debug-ui-panel button[aria-label="Toggle live/inspect mode"]').click();
    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
      return /mode=inspect/.test(t);
    });

    await expect(page.locator('.vacp-debug-ui-content')).toContainText('Inspect mode (time travel)');

    const playbookTab = page.locator('.vacp-debug-ui-module', { hasText: 'Playbook' });
    await expect(playbookTab).toBeVisible();
    await playbookTab.click();

    await page.locator('button[aria-label="Run step"]').click();
    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
      return /mode=live/.test(t);
    });
  } finally {
    await srv.stop();
  }
});
