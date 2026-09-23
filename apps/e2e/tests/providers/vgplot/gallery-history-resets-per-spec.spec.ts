import { expect } from '@playwright/test';
import { test } from '../../helpers/test';
import { appServer } from '../../helpers/servers';

test('switching gallery specs replaces the session and releases the previous recording', async ({ page }) => {
  const server = appServer('vgplot-gallery');
  await page.goto(`${server.url}#weather`);
  await page.waitForFunction(() => globalThis.__vacp?.sessionKey === 'vgplot/weather');
  const before = await page.evaluate(async () => {
    const runtime = window.__vacp!;
    await runtime.refresh!({ actor: { id: 'inspector', kind: 'human' }, message: 'Weather checkpoint' });
    return runtime.getProvenance();
  });
  expect(before.records.some((record) => record.message === 'Weather checkpoint')).toBe(true);
  await page.locator('#spec').selectOption({ label: 'Axes & Gridlines' });
  await page.waitForFunction(() => globalThis.__vacp?.sessionKey === 'vgplot/axes');
  const after = await page.evaluate(() => window.__vacp!.getProvenance());
  expect(after.runtimeId).not.toBe(before.runtimeId);
  expect(after.sessionKey).toBe('vgplot/axes');
  expect(after.records.some((record) => record.message === 'Weather checkpoint')).toBe(false);
});
