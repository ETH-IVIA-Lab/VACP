import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('vgplot: shared dataset uses a single DataHandle node (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const info = await page.evaluate(async () => {
      const caps = await (globalThis as any).__vacp.getCapabilities();
      const nodes = caps?.graph?.nodes ?? [];
      const edges = caps?.graph?.edges ?? [];
      const handles = nodes.filter((n: any) => n?.kind === 'DataHandle');
      const weather = handles.filter((n: any) => String(n?.data?.table ?? '') === 'weather');
      const ref = weather[0]?.ref ?? null;
      const containsEdges = typeof ref === 'string' ? edges.filter((e: any) => e?.kind === 'contains' && e?.to === ref) : [];
      return {
        handleCount: weather.length,
        handleRef: ref,
        containsFromCount: containsEdges.length,
      };
    });

    expect(info.handleCount).toBe(1);
    expect(typeof info.handleRef).toBe('string');
    expect(info.containsFromCount).toBeGreaterThanOrEqual(2);
  } finally {
    await srv.stop();
  }
});

