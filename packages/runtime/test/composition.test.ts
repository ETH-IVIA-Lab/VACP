import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION, type VacpProvider } from '@vacp/protocol';
import { composeVacpProviders } from '../src/composition';

function provider(args: {
  id: `vacp-source://${string}`;
  node: `vacp://${string}`;
  action: string;
  edges?: Array<{ from: `vacp://${string}`; to: `vacp://${string}`; kind: string }>;
  result: string;
  freshness?: 'current' | 'stale';
}): VacpProvider {
  return {
    source: { id: args.id, type: 'test', title: args.id },
    observe: () => ({
      revision: `${args.id}:1`,
      observedAt: '2026-09-18T12:00:00.000Z',
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: args.node, kind: 'TestOutput', layer: 'AnalysisLayer' }],
        edges: args.edges ?? [],
        actions: [
          {
            name: args.action,
            description: args.action,
            operation: {
              kind: 'evaluation',
              affects: [args.node],
              results: [{ role: 'visualization', ref: args.node }],
            },
          },
        ],
      },
      state: { [args.node]: { result: args.result } },
      freshness: args.freshness ? { [args.node]: { status: args.freshness } } : undefined,
    }),
    execute: async (call) => ({ callId: call.callId, ok: true, result: args.result }),
  };
}

test('composition preserves source ownership, cross-source relationships, freshness, and routing', async () => {
  const widgetRef = 'vacp://widget/filter';
  const chartRef = 'vacp://notebook/chart';
  const composed = composeVacpProviders([
    provider({
      id: 'vacp-source://widget',
      node: widgetRef,
      action: 'widget.update',
      result: 'widget',
    }),
    provider({
      id: 'vacp-source://notebook',
      node: chartRef,
      action: 'notebook.evaluate',
      edges: [{ from: widgetRef, to: chartRef, kind: 'controls' }],
      result: 'chart',
      freshness: 'stale',
    }),
  ]);
  try {
    const observation = await composed.observe();
    assert.deepEqual(
      observation.graph.sources.map((source) => source.id),
      ['vacp-source://widget', 'vacp-source://notebook'],
    );
    assert.equal(observation.graph.ownership.nodes[widgetRef], 'vacp-source://widget');
    assert.equal(observation.graph.ownership.actions['notebook.evaluate'], 'vacp-source://notebook');
    assert.deepEqual(observation.graph.edges, [{ from: widgetRef, to: chartRef, kind: 'controls' }]);
    assert.equal(observation.freshness?.[chartRef]?.status, 'stale');
    assert.deepEqual(await composed.execute({ callId: 'run', name: 'notebook.evaluate' }), {
      callId: 'run',
      ok: true,
      result: 'chart',
    });
  } finally {
    composed.dispose();
  }
});

test('composition rejects competing ownership instead of silently replacing providers', async () => {
  const composed = composeVacpProviders([
    provider({ id: 'vacp-source://first', node: 'vacp://shared', action: 'first', result: 'first' }),
    provider({ id: 'vacp-source://second', node: 'vacp://shared', action: 'second', result: 'second' }),
  ]);
  try {
    await assert.rejects(composed.observe(), /owned by both/);
  } finally {
    composed.dispose();
  }
});

test('composition retries observations invalidated while sources are being read', async () => {
  let invalidate = () => {};
  let reads = 0;
  const changing: VacpProvider = {
    source: { id: 'vacp-source://changing', type: 'test', title: 'Changing source' },
    subscribe: (listener) => {
      invalidate = listener;
      return () => {};
    },
    observe: () => {
      reads++;
      if (reads === 1) invalidate();
      return {
        revision: String(reads),
        observedAt: '2026-09-18T12:00:00.000Z',
        graph: {
          version: VACP_SCHEMA_VERSION,
          nodes: [{ ref: 'vacp://changing', kind: 'Output', layer: 'AnalysisLayer' }],
          edges: [],
          actions: [],
        },
        state: { 'vacp://changing': reads },
      };
    },
    execute: async (call) => ({ callId: call.callId, ok: true }),
  };
  const composed = composeVacpProviders([changing]);
  try {
    const observation = await composed.observe();
    assert.equal(reads, 2);
    assert.equal(observation.state['vacp://changing'], 2);
  } finally {
    composed.dispose();
  }
});
