import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpGraph, VacpRef } from '@vacp/core';

import { buildVacpFlowGraph, nodeId } from '../src/overlay/modules/graph/graph-model';

function ref(value: string): VacpRef {
  return value as VacpRef;
}

test('graph collapse keeps shared children visible through expanded parents', () => {
  const root = ref('vacp://example/root');
  const plotA = ref('vacp://example/plot/a');
  const plotB = ref('vacp://example/plot/b');
  const sharedData = ref('vacp://example/data/shared');
  const graph: VacpGraph = {
    nodes: [
      { ref: root, kind: 'View', layer: 'ViewLayer', title: 'Root' },
      { ref: plotA, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Plot A' },
      { ref: plotB, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Plot B' },
      { ref: sharedData, kind: 'DataHandle', layer: 'DataLayer', title: 'Shared data' },
    ],
    edges: [
      { from: root, to: plotA, kind: 'contains' },
      { from: root, to: plotB, kind: 'contains' },
      { from: plotA, to: sharedData, kind: 'contains' },
      { from: plotB, to: sharedData, kind: 'contains' },
    ],
    actions: [],
  };

  const flow = buildVacpFlowGraph({
    graph,
    direction: 'LR',
    includeActions: false,
    collapsedRefs: new Set([plotA]),
    selected: null,
    onToggleCollapse: () => {},
  });

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const collapsedPlot = flow.nodes.find((node) => node.id === nodeId(plotA));
  assert.equal(nodeIds.has(nodeId(sharedData)), true);
  assert.equal(collapsedPlot?.data.collapsedCount, 0);
  assert.equal(flow.counts.hiddenNodes, 0);
  assert.equal(
    flow.edges.some((edge) => edge.source === nodeId(plotB) && edge.target === nodeId(sharedData)),
    true,
  );
  assert.equal(
    flow.edges.some((edge) => edge.source === nodeId(plotA) && edge.target === nodeId(sharedData)),
    false,
  );
});

test('graph model marks the selected node in rendered node data', () => {
  const root = ref('vacp://example/root');
  const plot = ref('vacp://example/plot');
  const graph: VacpGraph = {
    nodes: [
      { ref: root, kind: 'View', layer: 'ViewLayer', title: 'Root' },
      { ref: plot, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Plot' },
    ],
    edges: [{ from: root, to: plot, kind: 'contains' }],
    actions: [],
  };

  const flow = buildVacpFlowGraph({
    graph,
    direction: 'LR',
    includeActions: false,
    collapsedRefs: new Set(),
    selected: { kind: 'node', ref: plot },
    onToggleCollapse: () => {},
  });

  const rootNode = flow.nodes.find((node) => node.id === nodeId(root));
  const selectedNode = flow.nodes.find((node) => node.id === nodeId(plot));
  assert.equal(rootNode?.data.selected, false);
  assert.equal(selectedNode?.data.selected, true);
});
