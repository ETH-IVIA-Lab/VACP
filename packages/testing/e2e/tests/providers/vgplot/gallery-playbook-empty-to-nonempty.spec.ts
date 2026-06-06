import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

test('vgplot-gallery: switching from no-playbook spec to playbook spec does not crash debug UI', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  const hookErrors: string[] = [];

  const maybeCapture = (text: string) => {
    if (/Rendered more hooks than during the previous render/i.test(text)) hookErrors.push(text);
    if (/change in the order of Hooks called by PlaybookModule/i.test(text)) hookErrors.push(text);
  };

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    maybeCapture(msg.text());
  });
  page.on('pageerror', (err) => maybeCapture(String(err?.message ?? err)));

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

    // Trigger an empty→non-empty playbook transition while the Playbook module is mounted.
    await page.locator('#spec').selectOption({ label: 'Seattle Weather' });

    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
    await expect(page.locator('#vacp-playbook')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#vacp-playbook')).toContainText('Seattle Weather');

    expect(hookErrors).toEqual([]);
  } finally {
    await srv.stop();
  }
});
