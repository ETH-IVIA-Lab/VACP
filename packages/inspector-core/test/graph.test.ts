import assert from 'node:assert/strict';
import test from 'node:test';
import { createInspectionIndex } from '../src/index';
import { observation } from './fixtures';

test('entity context preserves custom semantics, ownership and operation relationships', () => {
  const value = observation();
  value.graph.nodes.push({ ref: 'vacp://chart', kind: 'CustomPlot', layer: 'CustomLayer' });
  value.graph.ownership.nodes['vacp://chart'] = 'vacp-source://test';
  value.graph.edges.push({ from: 'vacp://value', to: 'vacp://chart', kind: 'feeds' });
  value.graph.actions[0].operation = {
    kind: 'evaluation',
    contract: 'custom.domain.evaluate',
    inputRefs: ['vacp://value'],
    affects: ['vacp://chart'],
    results: [{ role: 'visualization', ref: 'vacp://chart' }],
    refParameters: [{ parameter: 'input', role: 'input' }],
  };
  value.freshness!['vacp://chart'] = { status: 'stale', inputRevision: '2', outputRevision: '1' };
  const index = createInspectionIndex(value);
  const input = index.entity('vacp://value')!;
  const chart = index.entity('vacp://chart')!;
  assert.equal(input.node.kind, 'CustomParameter');
  assert.equal(input.hasValue, true);
  assert.equal(input.value, 0);
  assert.equal(chart.hasValue, false);
  assert.equal(chart.freshness?.status, 'stale');
  assert.equal(chart.source?.id, 'vacp-source://test');
  assert.equal(input.outgoing[0].kind, 'feeds');
  assert.equal(chart.incoming[0].from, 'vacp://value');
  assert.equal(chart.actions.length, 1);
  assert.equal(index.action('set')?.descriptor.operation.refParameters?.[0].parameter, 'input');
  assert.equal(index.action('set')?.source, index.source('vacp-source://test'));
  assert.equal(index.action('set')?.descriptor.operation.contract, 'custom.domain.evaluate');
  assert.equal(index.entity('vacp://missing'), undefined);
});

test('inspection retains unavailable catalog entries and explains prerequisite chains', () => {
  const value = observation();
  value.graph.nodes[0].availability = { unavailable: 'Choose a dataset' };
  value.graph.nodes.push({
    ref: 'vacp://chart',
    kind: 'Visualization',
    layer: 'ViewLayer',
    availability: { requires: ['vacp://value'] },
  });
  value.graph.actions[0].availability = { requires: ['vacp://chart'] };
  const index = createInspectionIndex(value);
  assert.deepEqual(index.availableActions, []);
  assert.deepEqual(index.action('set')?.availability.blockedBy, ['vacp://chart']);
  assert.equal(index.action('set')?.prerequisites[0].ref, 'vacp://chart');
  assert.deepEqual(index.entity('vacp://chart')?.availability.blockedBy, ['vacp://value']);
  assert.equal(index.entity('vacp://value')?.availability.reason, 'Choose a dataset');
  assert.equal(index.entity('vacp://value')?.dependents[0].ref, 'vacp://chart');
  assert.equal(index.entity('vacp://value')?.value, 0);
});
