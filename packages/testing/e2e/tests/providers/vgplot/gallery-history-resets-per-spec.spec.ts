import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

test('vgplot-gallery: history resets when switching specs (new VACP session)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const historyTab = page.getByRole('tab', { name: 'History' });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;
      await b.refresh?.({ source: 'debug', message: 'seed-A' });
      await b.refresh?.({ source: 'debug', message: 'seed-B' });
      await b.refresh?.({ source: 'debug', message: 'seed-C' });
    });

    const before = await page.evaluate(async () => {
      const rt = await (globalThis as any).__vacp.getRuntime?.();
      const messages = (rt?.history ?? []).map((h: any) => h?.message ?? '');
      return { len: (rt?.history ?? []).length, messages };
    });
    expect(before.len).toBeGreaterThanOrEqual(3);
    expect(before.messages.some((m) => /seed-A/.test(m))).toBeTruthy();

    // Switch to a different spec; the provider updates the runtime bridge.
    await page.locator('#spec').selectOption({ label: 'Axes & Gridlines' });

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const rt = await (globalThis as any).__vacp.getRuntime?.();
          const history = rt?.history ?? [];
          const first = history[0] ?? null;
          const messages = history.map((h: any) => h?.message ?? '');
          return { len: history.length, first, messages };
        });
      })
      .toMatchObject({
        first: {
          kind: 'mode',
        },
      });

    const after = await page.evaluate(async () => {
      const rt = await (globalThis as any).__vacp.getRuntime?.();
      const messages = (rt?.history ?? []).map((h: any) => h?.message ?? '');
      return { len: (rt?.history ?? []).length, messages };
    });

    expect(after.messages.some((m) => /seed-A|seed-B|seed-C/.test(m))).toBeFalsy();
    expect(after.messages.some((m) => /session changed: vgplot\/weather/.test(m))).toBeTruthy();
    expect(after.messages.some((m) => /→ vgplot\/axes/.test(m))).toBeTruthy();
  } finally {
    await srv.stop();
  }
});
