import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVacpAvailability, type VacpProvider } from '@ethivia/vacp-protocol';
import { createVacpRuntime } from '../src/index';

test('scoped capabilities retain prerequisite context without expanding the requested action space', async () => {
  const source: VacpProvider = {
    subscribe: () => () => {},
    source: { id: 'vacp-source://scope', type: 'test', title: 'Scope' },
    observe: () => ({
      observedAt: '',
      revision: '1',
      graph: {
        nodes: [
          { ref: 'vacp://data', kind: 'DataHandle', layer: 'DataLayer', data: { rows: 20 } },
          { ref: 'vacp://view', kind: 'View', layer: 'ViewLayer', availability: { requires: ['vacp://data'] } },
          { ref: 'vacp://bar', kind: 'Mark', layer: 'VisualizationLayer', availability: { requires: ['vacp://view'] } },
          { ref: 'vacp://legend', kind: 'Widget', layer: 'InteractionLayer' },
        ],
        edges: [{ from: 'vacp://view', to: 'vacp://bar', kind: 'contains' }],
        actions: [
          {
            name: 'click',
            description: 'Click the bar',
            operation: { kind: 'mutation' },
            availability: { requires: ['vacp://bar', 'vacp://legend'] },
          },
          {
            name: 'inspect-data',
            description: 'Inspect data',
            operation: { kind: 'query' },
            availability: { requires: ['vacp://data'] },
          },
        ],
      },
      state: {},
    }),
    prepare: async () => {
      throw new Error('Read-only fixture');
    },
  };
  const runtime = createVacpRuntime({ providers: [source] });
  try {
    const { graph } = await runtime.getCapabilities({
      refs: ['vacp://bar'],
      layers: ['VisualizationLayer'],
      includeNodeData: false,
    });
    assert.deepEqual(
      graph.nodes.map((node) => node.ref),
      ['vacp://data', 'vacp://view', 'vacp://bar', 'vacp://legend'],
    );
    assert.deepEqual(
      graph.actions.map((action) => action.name),
      ['click'],
    );
    assert.equal(resolveVacpAvailability(graph).actions.get('click')?.available, true);
    assert.equal(
      graph.nodes.some((node) => node.data !== undefined),
      false,
    );
    assert.deepEqual(
      Object.keys(graph.ownership.nodes),
      graph.nodes.map((node) => node.ref),
    );
    const withoutActions = await runtime.getCapabilities({ refs: ['vacp://bar'], includeActions: false });
    assert.deepEqual(
      withoutActions.graph.nodes.map((node) => node.ref),
      ['vacp://data', 'vacp://view', 'vacp://bar'],
    );
    assert.deepEqual(withoutActions.graph.actions, []);
    assert.equal(resolveVacpAvailability(withoutActions.graph).nodes.get('vacp://bar')?.available, true);
  } finally {
    runtime.dispose();
  }
});

test('ref scoping preserves exact matches, ancestor actions, and slash boundaries', async () => {
  const refs = [
    'vacp://scope/a',
    'vacp://scope/a/item',
    'vacp://scope/ab',
    'vacp://scope/a%2Fb',
    'vacp://scope/a/',
  ] as const;
  const runtime = createVacpRuntime({
    providers: [
      {
        subscribe: () => () => {},
        source: { id: 'vacp-source://scope', type: 'test', title: 'Scope' },
        observe: () => ({
          revision: '1',
          observedAt: '',
          graph: {
            nodes: refs.map((ref) => ({ ref, kind: 'Param', layer: 'ConfigLayer' })),
            edges: [],
            actions: refs.map((ref) => ({
              name: ref,
              description: ref,
              operation: { kind: 'mutation', affects: [ref] },
            })),
          },
          state: Object.fromEntries(refs.map((ref) => [ref, ref])),
          summary: Object.fromEntries(refs.map((ref) => [ref, { title: ref }])),
        }),
        prepare: async () => {
          throw new Error('Read-only fixture');
        },
      },
    ],
  });
  try {
    const exact = await runtime.getCapabilities({ refs: ['vacp://scope/a/item'] });
    assert.deepEqual(
      exact.graph.nodes.map((node) => node.ref),
      ['vacp://scope/a/item'],
    );
    assert.deepEqual(
      exact.graph.actions.map((action) => action.name),
      ['vacp://scope/a', 'vacp://scope/a/item'],
    );
    const nested = await runtime.getCapabilities({ prefixes: ['vacp://scope/a'] });
    const selected = ['vacp://scope/a', 'vacp://scope/a/item', 'vacp://scope/a/'];
    assert.deepEqual(
      nested.graph.nodes.map((node) => node.ref),
      selected,
    );
    const state = await runtime.getState({ refs: ['vacp://scope/a'] });
    assert.equal(state.mode, 'full');
    if (state.mode === 'full') {
      assert.deepEqual(Object.keys(state.snapshot.state), selected);
      assert.deepEqual(Object.keys(state.snapshot.summary!), selected);
    }
    const opaque = await runtime.getCapabilities({ prefixes: ['vacp://scope/a%2Fb'] });
    assert.deepEqual(
      opaque.graph.nodes.map((node) => node.ref),
      ['vacp://scope/a%2Fb'],
    );
    const trailing = await runtime.getCapabilities({ prefixes: ['vacp://scope/a/'] });
    assert.deepEqual(
      trailing.graph.nodes.map((node) => node.ref),
      ['vacp://scope/a/'],
    );
  } finally {
    runtime.dispose();
  }
});
