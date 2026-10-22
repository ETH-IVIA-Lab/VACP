import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacpProvider, VacpActionRegistry } from '../src/index';

test('a projection gives each node data of its own shape', async () => {
  const items = [
    { id: 'a', count: 1 },
    { id: 'b', count: 2 },
  ];
  const actions = new VacpActionRegistry();
  const provider = createVacpProvider({
    source: { id: 'vacp-source://form', type: 'test', title: 'Settings form' },
    actions,
    subscribe: () => () => {},
    project: () => ({
      graph: {
        nodes: [
          { ref: 'vacp://form', kind: 'View', layer: 'ViewLayer', data: { title: 'Settings' } },
          ...items.map((item) => ({
            ref: `vacp://form/item/${item.id}` as const,
            kind: 'Param',
            layer: 'ConfigLayer',
            data: { count: item.count, unit: null },
          })),
        ],
        edges: [],
        actions: actions.list(),
      },
      state: {},
    }),
  });
  const { graph } = await provider.observe();
  assert.deepEqual(
    graph.nodes.map((node) => node.data),
    [{ title: 'Settings' }, { count: 1, unit: null }, { count: 2, unit: null }],
  );
});
