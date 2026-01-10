import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('mosaic-gallery: playbook empty state for non-interactive spec', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1#axes`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const playbookTab = page.locator('.vacp-debug-ui-module', { hasText: 'Playbook' });
    await expect(playbookTab).toBeVisible();
    await playbookTab.click();

    await expect(page.locator('.vacp-debug-ui-content')).toContainText('No playbooks were provided');
  } finally {
    await srv.stop();
  }
});
