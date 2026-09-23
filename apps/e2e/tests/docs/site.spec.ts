import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';

test('documentation serves public guides and the executable integration example', async ({ page }, testInfo) => {
  const server = appServer('docs');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.url}integrate/`);
  await expect(page.locator('.vp-doc h1')).toContainText('Connect an analytical source');
  await expect(page.locator('.vp-doc')).toContainText('connectThreshold');
  await expect(page.locator('.vp-doc')).toContainText("from '@vacp/sdk'");
  await page.getByRole('link', { name: 'Browser adapter', exact: true }).click();
  await expect(page.locator('.vp-doc h1')).toContainText('Browser adapter');
  await expect(page.locator('.vp-doc')).toContainText('uninstallVacpRuntime');
  await page.screenshot({ path: testInfo.outputPath('browser-adapter-guide.png'), fullPage: true });
  expect(errors).toEqual([]);
});
