import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

async function openActionsTab(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Actions' }).click();
}

async function openRawParams(page: Page) {
  const editor = page.locator('[data-vacp-json-editor="vacp-action-params"]');
  await editor.getByRole('button', { name: 'Raw' }).click();
  return editor.locator('[data-vacp-json-editor-raw="vacp-action-params"]');
}

async function actionHistoryCount(page: Page, actionName: string): Promise<number> {
  return await page.evaluate(async (name) => {
    const runtime = await (globalThis as any).__vacp.getRuntime();
    const history = Array.isArray(runtime.history) ? runtime.history : [];
    return history.filter((entry: any) => entry?.kind === 'action' && entry?.call?.name === name).length;
  }, actionName);
}

test('debug-ui: Actions seeds interval params and blocks missing required params locally', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1#line-density`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });
    await openActionsTab(page);

    await page.getByRole('button', { name: /vgplot\.set_interval_2d/ }).click();
    const guidance = page.locator('[data-vacp-action-param-guidance="1"]');
    await expect(guidance).toContainText('Ready to run');

    const raw = await openRawParams(page);
    await expect.poll(async () => {
      const params = JSON.parse(await raw.inputValue());
      const hasDomainValues = ['x0', 'x1', 'y0', 'y1'].every((key) => {
        const value = params[key];
        return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length > 0);
      });
      return { ...params, hasDomainValues };
    }).toEqual(
      expect.objectContaining({
        plotId: 'plot-1',
        interactorId: '0',
        hasDomainValues: true,
      }),
    );

    await page.getByRole('button', { name: 'Run action' }).click();
    await expect(page.locator('[data-vacp-action-result="1"]')).toContainText('"ok":true', { timeout: 15_000 });

    const beforeInvalid = await actionHistoryCount(page, 'vgplot.set_interval_2d');
    await raw.fill('{}');
    await page.getByRole('button', { name: 'Run action' }).click();
    await expect(guidance).toContainText('Fix params before running');
    await expect(page.locator('[data-vacp-action-result="1"]')).toContainText('Fix params before running');
    await page.waitForTimeout(500);
    expect(await actionHistoryCount(page, 'vgplot.set_interval_2d')).toBe(beforeInvalid);
  } finally {
    await srv.stop();
  }
});

test('debug-ui: Actions seeds and runs PanZoom params from current domains', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1#pan-zoom`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });
    await openActionsTab(page);

    await page.getByRole('button', { name: /vgplot\.set_pan_zoom/ }).click();
    const guidance = page.locator('[data-vacp-action-param-guidance="1"]');
    await expect(guidance).toContainText('Ready to run');

    const raw = await openRawParams(page);
    await expect.poll(async () => JSON.parse(await raw.inputValue())).toEqual(
      expect.objectContaining({
        plotId: 'plot-0',
        interactorId: '0',
        x0: expect.any(Number),
        x1: expect.any(Number),
        y0: expect.any(Number),
        y1: expect.any(Number),
      }),
    );

    await page.getByRole('button', { name: 'Run action' }).click();
    await expect(page.locator('[data-vacp-action-result="1"]')).toContainText('"ok":true', { timeout: 15_000 });
  } finally {
    await srv.stop();
  }
});
