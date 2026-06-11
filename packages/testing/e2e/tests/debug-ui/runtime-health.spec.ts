import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

test('debug-ui: runtime health strip surfaces console runtime and network failures', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1#aeromagnetic-survey`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const health = page.locator('[data-vacp-runtime-health="1"]');
    await expect(health).toBeVisible();
    await expect(health).toContainText('Bridge');
    await expect(health).toContainText('ok');
    await expect(health).toContainText('Console');
    await expect(health).toContainText('Network');

    await page.evaluate(async () => {
      console.error('health probe console');
      window.dispatchEvent(new ErrorEvent('error', { message: 'health probe runtime' }));
      await fetch('http://127.0.0.1:9/__vacp_health_probe').catch(() => undefined);
    });

    await expect(health).toContainText(/Console\s*1/);
    await expect(health).toContainText(/Runtime\s*1/);
    await expect(health).toContainText(/Network\s*1/);
    await expect(health).toContainText('__vacp_health_probe');
  } finally {
    await srv.stop();
  }
});
