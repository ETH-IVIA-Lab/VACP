import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVacpAvailability, VACP_SCHEMA_VERSION, type VacpProvider } from '@vacp/protocol';
import { createVacpRuntime } from '../src/index';

test('scoped capabilities retain prerequisite context without expanding the requested action space', async () => {
  const source: VacpProvider = {
    source: { id: 'vacp-source://scope', type: 'test', title: 'Scope' },
    observe: () => ({
      observedAt: '',
      revision: '1',
      graph: {
        version: VACP_SCHEMA_VERSION,
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
