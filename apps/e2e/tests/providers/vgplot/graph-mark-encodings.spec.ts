import { expect } from '@playwright/test';
import { test } from '../../helpers/test';

import { appServer } from '../../helpers/servers';

test('vgplot: capability graph includes mark encoding channels + fields (Seattle Weather)', async ({ page }) => {
  const srv = appServer('vgplot-gallery');

  await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__vacp);

  const graph = await page.evaluate(async () => {
    const cap = await globalThis.__vacp.getCapabilities?.();

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

  const hasNamedField = nodes.some(
    (n) => n.kind === 'EncodedField' && typeof n.data?.fieldName === 'string' && n.data.fieldName.length > 0,
  );

  expect(hasNamedField).toBeTruthy();
  const handles = nodes.filter((node) => node.kind === 'DataHandle' && node.data?.table === 'weather');
  expect(handles).toHaveLength(1);
  const users = edges.filter((edge) => edge.kind === 'contains' && edge.to === handles[0].ref);
  expect(new Set(users.map((edge) => edge.from)).size).toBeGreaterThanOrEqual(2);
  expect(users.every((edge) => nodeByRef.get(edge.from)?.kind === 'Visualization')).toBe(true);
});

test('vgplot: capability graph keeps refs unique when marks share a runtime index (Axes)', async ({ page }) => {
  const srv = appServer('vgplot-gallery');

  await page.goto(`${srv.url}#axes`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__vacp);

  const nodes = await page.evaluate(async () => {
    const cap = await globalThis.__vacp.getCapabilities?.();

    return cap?.graph?.nodes ?? [];
  });

  const refs = nodes.map((node: any) => String(node.ref));
  expect(new Set(refs).size).toBe(refs.length);

  const duplicateRuntimeMarks = nodes.filter((node: any) => node.kind === 'Mark' && node.data?.index === -1);
  expect(duplicateRuntimeMarks.length).toBeGreaterThanOrEqual(2);
});
