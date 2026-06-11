import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

async function openDebugUi(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible({ timeout: 15_000 });
}

test('debug-ui: JSON apply reports read-only DataHandle refs', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1#us-state-map`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const { state, ref } = await page.evaluate(async () => {
      const vacp = (globalThis as any).__vacp;
      const snap = await vacp.getState();
      const dataRef = Object.entries(snap.state).find(([, value]) => (value as any)?.kind === 'DataHandle')?.[0];
      if (!dataRef) throw new Error('Missing DataHandle state ref');

      const nextState = structuredClone(snap.state);
      nextState[dataRef] = { ...nextState[dataRef], auditProbe: 'json-tab-apply' };
      return { state: nextState, ref: dataRef };
    });

    await openDebugUi(page);
    await page.getByRole('tab', { name: 'JSON' }).click();

    const editor = page.locator('[data-vacp-json-editor="vacp-state-override"]');
    await editor.getByRole('button', { name: 'Raw' }).click();
    await editor.locator('[data-vacp-json-editor-raw="vacp-state-override"]').fill(JSON.stringify(state, null, 2));
    await page.locator('button[aria-label="Apply to app"]').click();

    await expect(page.getByText(/No app state changed/i)).toBeVisible({ timeout: 15_000 });
    const report = page.locator('[data-vacp-json-apply-report="1"]');
    await expect(report).toBeVisible();
    await expect(report).toContainText('No state refs changed');
    await expect(report).toContainText(ref);
    await expect(report).toContainText(/read-only|controlled by plot/i);
  } finally {
    await srv.stop();
  }
});
