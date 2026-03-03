import { expect, test } from '@playwright/test';

import { startViteDevServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

test('vgplot: capability graph includes mark encoding channels + fields (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${srv.url}?vacp-debug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const graph = await page.evaluate(async () => {
      const cap = await (globalThis as any).__vacp.getCapabilities?.();
      return cap?.graph ?? null;
    });
    expect(graph).toBeTruthy();

    const nodes: any[] = graph.nodes ?? [];
    const edges: any[] = graph.edges ?? [];
    const nodeByRef = new Map<string, any>(nodes.map((n) => [n.ref, n]));

    const mark = nodes.find((n) => n.kind === 'Mark');
    expect(mark).toBeTruthy();

    const markToChannel = edges.find(
      (e) => e.kind === 'contains' && e.from === mark.ref && nodeByRef.get(e.to)?.kind === 'EncodingChannel',
    );
    expect(markToChannel).toBeTruthy();

    const channel = nodeByRef.get(markToChannel.to);
    expect(channel?.data?.channel).toBeTruthy();

    const channelToField = edges.find(
      (e) => e.kind === 'contains' && e.from === channel.ref && nodeByRef.get(e.to)?.kind === 'EncodedField',
    );
    expect(channelToField).toBeTruthy();

    const field = nodeByRef.get(channelToField.to);
    expect(field?.data?.field).toBeDefined();
    // At least one encoded field should expose a concrete field name string.
    const hasNamedField = nodes.some(
      (n) => n.kind === 'EncodedField' && typeof n.data?.fieldName === 'string' && n.data.fieldName.length > 0,
    );
    expect(hasNamedField).toBeTruthy();
  } finally {
    await srv.stop();
  }
});
