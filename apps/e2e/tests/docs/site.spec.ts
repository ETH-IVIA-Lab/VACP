import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';

test('documentation serves the integration guide with its executable example and reaches the reference', async ({
  page,
}, testInfo) => {
  const server = appServer('docs');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.url}integrate/`);
  await expect(page.locator('.vp-doc h1')).toHaveText('Connect an application');
  await expect(page.locator('.vp-doc')).toContainText('connectThreshold');
  await expect(page.locator('.vp-doc')).toContainText("from '@ethivia/vacp-sdk'");
  await page.getByRole('link', { name: 'API reference', exact: true }).first().click();
  await page.getByRole('link', { name: '@ethivia/vacp-runtime-browser', exact: true }).first().click();
  await expect(page.locator('.vp-doc h1')).toHaveText('@ethivia/vacp-runtime-browser');
  await expect(page.locator('.vp-doc')).toContainText('installVacpRuntime');
  await page.screenshot({ path: testInfo.outputPath('runtime-browser-reference.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('the overview renders its architecture diagram', async ({ page }) => {
  const server = appServer('docs');
  await page.goto(`${server.url}what-is-vacp/`);
  const diagram = page.getByRole('img', { name: 'VACP architecture' });
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText('@ethivia/vacp-runtime');
});
