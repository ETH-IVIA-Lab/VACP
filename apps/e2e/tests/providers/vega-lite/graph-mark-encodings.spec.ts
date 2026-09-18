import { expect, test } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

async function expectBridge(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => !!globalThis.__vacp);
}

async function waitForCapabilityRefContains(
  page: import('@playwright/test').Page,
  needle: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();

  while (true) {
    const ok = await page.evaluate(async (n) => {
      const caps = await globalThis.__vacp.getCapabilities();
      const nodes = caps?.graph?.nodes ?? [];

      return nodes.some((x: any) => typeof x?.ref === 'string' && String(x.ref).includes(n));
    }, needle);

    if (ok) return;

    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for capability ref containing: ${needle}`);
    await page.waitForTimeout(150);
  }
}

test('vega-lite: capability graph includes mark encoding channels + fields across gallery specs', async ({ page }) => {
  const srv = await startAppServer({ name: 'vega-lite-gallery', cwd: exampleDir('vega-lite-gallery') });

  try {
    await page.goto(`${srv.url}`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);

    const specIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('#spec option')).map((o) => o.value),
    );

    expect(specIds.length).toBeGreaterThanOrEqual(3);

    const expectedFieldsBySpec: Record<string, string[]> = {
      'seattle-weather': ['weather', 'date', 'temp_max'],
      airports: ['origin', 'destination', 'lat', 'lon', 'latitude', 'longitude'],
      'global-development': ['fertility', 'life_expect', 'country'],
    };

    for (const specId of specIds) {
      await page.evaluate((id) => {
        const sel = document.querySelector<HTMLSelectElement>('#spec');

        if (!sel) throw new Error('Missing #spec');
        sel.value = id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, specId);

      await page.waitForSelector('#app canvas.marks, #app svg.marks', { timeout: 30_000 });
      await expectBridge(page);
      await waitForCapabilityRefContains(page, `/vega-lite/${specId}/${specId}`);

      const graph = await page.evaluate(async () => {
        const cap = await globalThis.__vacp.getCapabilities?.();

        return cap?.graph ?? null;
      });

      expect(graph).toBeTruthy();

      const nodes: any[] = graph.nodes ?? [];
      const edges: any[] = graph.edges ?? [];
      const nodeByRef = new Map<string, any>(nodes.map((n) => [n.ref, n]));

      const marks = nodes.filter((n) => n.kind === 'Mark');
      expect(marks.length).toBeGreaterThan(0);

      const channels = nodes.filter((n) => n.kind === 'EncodingChannel');
      expect(channels.length).toBeGreaterThan(0);

      const fields = nodes.filter((n) => n.kind === 'EncodedField');
      expect(fields.length).toBeGreaterThan(0);

      const markToChannel = edges.find(
        (e) =>
          e.kind === 'contains' &&
          nodeByRef.get(e.from)?.kind === 'Mark' &&
          nodeByRef.get(e.to)?.kind === 'EncodingChannel',
      );

      expect(markToChannel).toBeTruthy();

      const channelToField = edges.find(
        (e) =>
          e.kind === 'contains' &&
          nodeByRef.get(e.from)?.kind === 'EncodingChannel' &&
          nodeByRef.get(e.to)?.kind === 'EncodedField',
      );

      expect(channelToField).toBeTruthy();

      const namedFields = fields.flatMap((n) =>
        typeof n?.data?.fieldName === 'string' && n.data.fieldName.length > 0 ? [n.data.fieldName] : [],
      );

      expect(namedFields.length).toBeGreaterThan(0);

      const expected = expectedFieldsBySpec[specId] ?? [];

      if (expected.length) {
        expect(expected.some((f) => namedFields.includes(f))).toBeTruthy();
      }
    }
  } finally {
    await srv.stop();
  }
});
