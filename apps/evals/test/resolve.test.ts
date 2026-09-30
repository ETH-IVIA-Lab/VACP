import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpGraph } from '@vacp/protocol';
import { resolveAction } from '../src/core/resolve';

const selection = (name: string) => ({
  name,
  description: 'Set the brush.',
  operation: { kind: 'mutation' as const, contract: 'vega_lite.set_selection' },
});

const graph: Pick<VacpGraph, 'actions' | 'ownership'> = {
  actions: [
    selection('left.vega_lite.set_selection'),
    selection('right.vega_lite.set_selection'),
    { name: 'cohort.set_sex', description: 'Set the sex.', operation: { kind: 'mutation' } },
  ],
  ownership: {
    nodes: {
      'vacp://app/left/param/brush': 'vacp-source://left',
      'vacp://app/right/param/brush': 'vacp-source://right',
    },
    actions: {
      'left.vega_lite.set_selection': 'vacp-source://left',
      'right.vega_lite.set_selection': 'vacp-source://right',
      'cohort.set_sex': 'vacp-source://cohort',
    },
  },
};

test('a scenario action resolves by local name, or by contract through the source that owns its ref', () => {
  assert.equal(resolveAction(graph, { action: 'cohort.set_sex' }), 'cohort.set_sex');
  assert.equal(
    resolveAction(graph, { action: 'vega_lite.set_selection', params: { ref: 'vacp://app/right/param/brush' } }),
    'right.vega_lite.set_selection',
  );
  assert.throws(() => resolveAction(graph, { action: 'vega_lite.set_selection' }), /matches 2 live actions/);
});
