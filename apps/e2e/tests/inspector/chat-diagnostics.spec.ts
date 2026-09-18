import { expect, test } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';
import { runtimeId, seedInspectorChatThreadOnNextLoad, waitForVacpBridge } from './helpers';

const artifactsDir = artifactDir('playwright-inspector-chat-diagnostics');

const RUNTIME_ID = '00000000-0000-4000-8000-000000000103';

const THREAD_ID = 'thread:diagnostics';

test('inspector: chat shows endpoint diagnostics for configured OpenAI-compatible provider', async ({ page }) => {
  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
    artifactsDir,
  });

  try {
    await seedInspectorChatThreadOnNextLoad(page, {
      runtimeId: RUNTIME_ID,
      threadId: THREAD_ID,
      question: 'What data handles are visible?',
      answer: 'One data handle is visible.',
      label: 'aeromagnetic-survey',
      sessionKey: 'vgplot/aeromagnetic-survey',
      viewRef: 'vacp://vacp-examples/vgplot/aeromagnetic-survey',
      vizRef: 'vacp://vacp-examples/vgplot/aeromagnetic-survey/plot-0',
      baseURL: 'http://localhost:8317/v1',
      apiKey: 'sk-',
      model: 'gpt-5.4-mini',
      clearLayoutStorage: true,
    });
    await page.goto(`${srv.url}?vacp-inspector=1&vacp-runtime-id=${RUNTIME_ID}#aeromagnetic-survey`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForVacpBridge(page, { requireRuntime: true });
    await expect.poll(async () => await runtimeId(page)).toBe(RUNTIME_ID);

    const pill = page.locator('button.vacp-inspector-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-inspector-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Chat' }).click();
    const diagnostics = page.locator('[data-vacp-chat-endpoint-diagnostics="1"]');
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics).toContainText('Endpoint not checked');
    await expect(diagnostics).toContainText('http://localhost:8317/v1');
    await expect(diagnostics).toContainText('gpt-5.4-mini');
  } finally {
    await srv.stop();
  }
});
