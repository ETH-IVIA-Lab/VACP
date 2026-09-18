import { expect, test } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

test('bridge exposure follows the URL on reload while DOM snapshots remain readable', async ({ page }) => {
  const srv = await startAppServer({ name: 'cars-parallel-coords', cwd: exampleDir('cars-parallel-coords') });
  try {
    for (const enabled of [false, true, false]) {
      await test.step(`reload with expose-bridge=${Number(enabled)}`, async () => {
        await page.goto(`${srv.url}?expose-bridge=${Number(enabled)}`, { waitUntil: 'domcontentloaded' });
        const snapshot = page.locator('#__vacp_snapshot');
        await expect
          .poll(async () => JSON.parse((await snapshot.textContent()) || '{}').format)
          .toBe('vacp.dom_snapshot');
        const manifest = JSON.parse((await snapshot.textContent())!);
        expect(manifest.format).toBe('vacp.dom_snapshot');
        expect(manifest.state.refCount).toBeGreaterThan(0);
        expect(await page.evaluate(() => '__vacp' in globalThis)).toBe(enabled);
        if (enabled) {
          const state = await page.evaluate(async () => (await globalThis.__vacp.getState()).state);
          expect(Object.keys(state).length).toBe(manifest.state.refCount);
        }
      });
    }
  } finally {
    await srv.stop();
  }
});
