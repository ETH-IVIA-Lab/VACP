import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('mosaic: set_interval_1d triggers downstream crossfilters (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    // Capture a stable-ish fingerprint of the *second* plot (the bar chart) before the action.
    const before = await page.evaluate(() => {
      const root = document.querySelector('#app');
      if (!root) return null;
      const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
      const hosts = all.filter((el) => {
        const v = (el as any).value;
        return v && typeof v === 'object' && Array.isArray(v.marks) && Array.isArray(v.interactors);
      });
      const host = hosts[1] as Element | undefined;
      const svg = host?.querySelector('svg');
      return svg?.outerHTML ?? null;
    });
    expect(before).toBeTruthy();

    // Programmatic brush (June–Aug) on the scatter plot should change the bottom bar chart.
    const callId = crypto.randomUUID();
    const res = await page.evaluate(async ({ callId }) => {
      const vacp = (globalThis as any).__vacp;
      return await vacp.execute({
        callId,
        name: 'mosaic.set_interval_1d',
        params: {
          plotId: 'plot-0',
          interactorId: '0',
          min: 1338508800000,
          max: 1346457600000,
        },
      });
    }, { callId });
    expect(res?.ok).toBeTruthy();

    await page.waitForFunction(
      ({ before }) => {
        const root = document.querySelector('#app');
        if (!root) return false;
        const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
        const hosts = all.filter((el) => {
          const v = (el as any).value;
          return v && typeof v === 'object' && Array.isArray(v.marks) && Array.isArray(v.interactors);
        });
        const host = hosts[1] as Element | undefined;
        const svg = host?.querySelector('svg');
        const now = svg?.outerHTML ?? '';
        return !!before && now.length > 0 && now !== before;
      },
      { before },
      { timeout: 15_000 },
    );
  } finally {
    await srv.stop();
  }
});

