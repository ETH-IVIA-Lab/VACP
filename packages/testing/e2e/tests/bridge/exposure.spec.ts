import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

test('expose-bridge=0 hides window.__vacp (but snapshot may still exist)', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?expose-bridge=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#container');

    const bridge = await page.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(globalThis, '__vacp');
      const v = (globalThis as any).__vacp;
      return { hasOwn: Boolean(d), inOperator: '__vacp' in globalThis, type: typeof v };
    });
    expect(bridge.hasOwn).toBe(false);
    expect(bridge.inOperator).toBe(false);
    expect(bridge.type).toBe('undefined');

    const snapText = await page.locator('#__vacp_snapshot').textContent();
    expect(snapText).toBeTruthy();
    expect(() => JSON.parse(snapText ?? '')).not.toThrow();
  } finally {
    await srv.stop();
  }
});

test('expose-bridge=1 keeps window.__vacp', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?expose-bridge=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const bridge = await page.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(globalThis, '__vacp');
      const v = (globalThis as any).__vacp;
      return { hasOwn: Boolean(d), inOperator: '__vacp' in globalThis, type: typeof v };
    });
    expect(bridge.hasOwn).toBe(true);
    expect(bridge.inOperator).toBe(true);
    expect(bridge.type).toBe('object');
  } finally {
    await srv.stop();
  }
});
