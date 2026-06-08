import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';
import { runtimeId, waitForVacpBridge } from './helpers';

const artifactsDir = artifactDir('playwright-debug-ui-chat-setup');
const RUNTIME_ID = '00000000-0000-4000-8000-000000000102';

test('debug-ui: chat tab keeps the conversation surface visible before provider setup', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
    artifactsDir,
  });

  try {
    await page.addInitScript(() => {
      localStorage.removeItem('vacp:debug:chat:llmConfig:v1');
      localStorage.removeItem('vacp:debug:chat:history:v1');
      localStorage.removeItem('vacp:debug:size');
      localStorage.removeItem('vacp:debug:dock');
    });
    await page.goto(`${srv.url}?vacp-debug=1&vacp-runtime-id=${RUNTIME_ID}#wnba-shots`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForVacpBridge(page, { requireRuntime: true });
    await expect.poll(async () => await runtimeId(page)).toBe(RUNTIME_ID);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Chat' }).click();

    await expect(page.locator('[data-vacp-chat-msgs="1"]')).toBeVisible();
    await expect(page.locator('[data-vacp-chat-input="1"]')).toBeVisible();
    await expect(page.locator('[data-vacp-chat-status="1"]')).toContainText('Setup needed');
    await expect(page.locator('[data-vacp-chat-send="1"]')).toBeDisabled();
    await expect(page.locator('[data-vacp-chat-settings-panel="1"]')).toBeVisible();
  } finally {
    await srv.stop();
  }
});
