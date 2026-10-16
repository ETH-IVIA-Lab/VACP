import { expect } from '@playwright/test';
import { test } from '../../helpers/test';

import { gotoApp } from '../../helpers/servers';

async function expectBridge(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => !!globalThis.__vacp);
}

async function waitForCapabilityRefContains(
  page: import('@playwright/test').Page,
  needle: string,
  timeoutMs = 60_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (needle) => {
          const caps = await globalThis.__vacp.getCapabilities();
          return caps.graph.nodes.some((node: { ref: string }) => node.ref.includes(needle));
        }, needle),
      { timeout: timeoutMs, message: `Capability graph contains ${needle}` },
    )
    .toBe(true);
}

test('vega-lite: capability graph includes mark encoding channels + fields across gallery specs', async ({ page }) => {
  await gotoApp(page, 'vega-lite-gallery');

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
});
