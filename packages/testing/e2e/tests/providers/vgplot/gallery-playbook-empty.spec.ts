import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

test('vgplot-gallery: playbook empty state for non-interactive spec', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#axes`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const playbookTab = page.locator('.vacp-debug-ui-module', { hasText: 'Playbook' });
    await expect(playbookTab).toBeVisible();
    await playbookTab.click();

    await expect(page.locator('.vacp-debug-ui-content')).toContainText('No guided playbook is available for this view');
  } finally {
    await srv.stop();
  }
});
