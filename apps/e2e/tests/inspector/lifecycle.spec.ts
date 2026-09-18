import { expect, test } from '@playwright/test';
import { startAppServer } from '../helpers/devserver';
import { exampleDir, repoRoot } from '../helpers/paths';

test('Inspector installation can be disposed and mounted again', async ({ page }) => {
  const server = await startAppServer({ name: 'inspector-lifecycle', cwd: exampleDir('cars-parallel-coords') });

  try {
    await page.goto(`${server.url}?vacp-inspector=0`);
    await page.waitForFunction(() => Boolean(window.__vacp));
    const entry = `/@fs${repoRoot}/packages/inspector/src/index.ts`;
    await page.evaluate(async (url) => {
      const { installVacpInspector } = await import(url);
      window.__vacpHostHooks = {
        fetch: window.fetch,
        open: XMLHttpRequest.prototype.open,
        send: XMLHttpRequest.prototype.send,
        error: console.error,
      };
      installVacpInspector({ enabled: true });
    }, entry);
    await expect(page.locator('#vacp-inspector-react-root')).toBeAttached();
    await page.waitForFunction(() => window.fetch !== window.__vacpHostHooks?.fetch);
    await page.evaluate(async (url) => {
      const { installVacpInspector } = await import(url);
      const handle = installVacpInspector({ enabled: true });
      handle.dispose();
      handle.dispose();
    }, entry);
    await expect(page.locator('#vacp-inspector-react-root')).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const original = window.__vacpHostHooks;
        return {
          fetch: window.fetch === original?.fetch,
          open: XMLHttpRequest.prototype.open === original?.open,
          send: XMLHttpRequest.prototype.send === original?.send,
          error: console.error === original?.error,
        };
      }),
    ).toEqual({ fetch: true, open: true, send: true, error: true });
    await page.evaluate(async (url) => {
      const { installVacpInspector } = await import(url);
      installVacpInspector({ enabled: true });
    }, entry);
    await expect(page.locator('#vacp-inspector-react-root')).toBeAttached();
    await expect(page.locator('button.vacp-inspector-button')).toBeVisible();
  } finally {
    await server.stop();
  }
});
