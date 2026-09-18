import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { startAppServer } from '../helpers/devserver';
import { repoRoot } from '../helpers/paths';

test('documentation serves public guides and the executable integration example', async ({ page }, testInfo) => {
  const server = await startAppServer({ name: 'docs-preview', cwd: resolve(repoRoot, 'apps/docs'), script: 'preview' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(`${server.url}integrate/`);
    await expect(page.locator('.vp-doc h1')).toContainText('Connect an analytical source');
    await expect(page.locator('.vp-doc')).toContainText('connectThreshold');
    await expect(page.locator('.vp-doc')).toContainText("from '@vacp/sdk'");
    await page.getByRole('link', { name: 'Browser adapter', exact: true }).click();
    await expect(page.locator('.vp-doc h1')).toContainText('Browser adapter');
    await expect(page.locator('.vp-doc')).toContainText('uninstallVacpRuntime');
    await page.screenshot({ path: testInfo.outputPath('browser-adapter-guide.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
