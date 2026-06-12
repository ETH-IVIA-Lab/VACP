import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpGraph, VacpRef } from '@vacp/core';

import {
  buildInspectorValue,
  buildVacpFlowGraph,
  filterVacpGraph,
  nodeId,
} from '../src/overlay/modules/graph/graph-model';
import { nextCollapsedRefsForToggle } from '../src/overlay/modules/graph/graph-collapse';

function ref(value: string): VacpRef {
  return value as VacpRef;
}

function noopSelect(): void {}

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
    onSelect: noopSelect,
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
    onSelect: noopSelect,
  });

  const rootNode = flow.nodes.find((node) => node.id === nodeId(root));
  const selectedNode = flow.nodes.find((node) => node.id === nodeId(plot));
  assert.equal(rootNode?.data.selected, false);
  assert.equal(selectedNode?.data.selected, true);
});

test('graph expansion reveals a collapsed branch one level at a time', () => {
  const root = ref('vacp://example/root');
  const plot = ref('vacp://example/plot');
  const mark = ref('vacp://example/mark');
  const field = ref('vacp://example/field');
  const graph: VacpGraph = {
    nodes: [
      { ref: root, kind: 'View', layer: 'ViewLayer', title: 'Root' },
      { ref: plot, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Plot' },
      { ref: mark, kind: 'Mark', layer: 'VisualizationLayer', title: 'Point' },
      { ref: field, kind: 'EncodedField', layer: 'VisualizationLayer', title: 'Horsepower' },
    ],
    edges: [
      { from: root, to: plot, kind: 'contains' },
      { from: plot, to: mark, kind: 'contains' },
      { from: mark, to: field, kind: 'contains' },
    ],
    actions: [],
  };

  let collapsedRefs = nextCollapsedRefsForToggle(graph, new Set(), root);

  let flow = buildVacpFlowGraph({
    graph,
    direction: 'LR',
    includeActions: false,
    collapsedRefs,
    selected: null,
    onToggleCollapse: () => {},
    onSelect: noopSelect,
  });
  let nodeIds = new Set(flow.nodes.map((node) => node.id));
  assert.equal(nodeIds.has(nodeId(root)), true);
  assert.equal(nodeIds.has(nodeId(plot)), false);
  assert.equal(flow.counts.hiddenNodes, 3);

  collapsedRefs = nextCollapsedRefsForToggle(graph, collapsedRefs, root);
  flow = buildVacpFlowGraph({
    graph,
    direction: 'LR',
    includeActions: false,
    collapsedRefs,
    selected: null,
    onToggleCollapse: () => {},
    onSelect: noopSelect,
  });
  nodeIds = new Set(flow.nodes.map((node) => node.id));
  assert.equal(nodeIds.has(nodeId(root)), true);
  assert.equal(nodeIds.has(nodeId(plot)), true);
  assert.equal(nodeIds.has(nodeId(mark)), false);
  assert.equal(flow.counts.hiddenNodes, 2);

  collapsedRefs = nextCollapsedRefsForToggle(graph, collapsedRefs, plot);
  flow = buildVacpFlowGraph({
    graph,
    direction: 'LR',
    includeActions: false,
    collapsedRefs,
    selected: null,
    onToggleCollapse: () => {},
    onSelect: noopSelect,
  });
  nodeIds = new Set(flow.nodes.map((node) => node.id));
  assert.equal(nodeIds.has(nodeId(mark)), true);
  assert.equal(nodeIds.has(nodeId(field)), false);
  assert.equal(flow.counts.hiddenNodes, 1);

  collapsedRefs = nextCollapsedRefsForToggle(graph, collapsedRefs, mark);
  flow = buildVacpFlowGraph({
    graph,
    direction: 'LR',
    includeActions: false,
    collapsedRefs,
    selected: null,
    onToggleCollapse: () => {},
    onSelect: noopSelect,
  });
  nodeIds = new Set(flow.nodes.map((node) => node.id));
  assert.equal(nodeIds.has(nodeId(field)), true);
  assert.equal(flow.counts.hiddenNodes, 0);
});

test('graph filter keeps search matches with graph context', () => {
  const root = ref('vacp://example/root');
  const plot = ref('vacp://example/plot');
  const field = ref('vacp://example/plot/encoding/x/field-body_mass');
  const other = ref('vacp://example/other');
  const graph: VacpGraph = {
    nodes: [
      { ref: root, kind: 'View', layer: 'ViewLayer', title: 'Root' },
      { ref: plot, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Plot' },
      { ref: field, kind: 'EncodedField', layer: 'DataLayer', title: 'body_mass' },
      { ref: other, kind: 'Widget', layer: 'ConfigLayer', title: 'Control' },
    ],
    edges: [
      { from: root, to: plot, kind: 'contains' },
      { from: plot, to: field, kind: 'contains' },
      { from: root, to: other, kind: 'contains' },
    ],
    actions: [
      {
        name: 'vacp.data_schema',
        description: 'Describe body_mass data.',
        targetRef: field,
      },
    ],
  };

  const filtered = filterVacpGraph(graph, { query: 'body_mass' });
  assert.deepEqual(filtered.nodes.map((node) => node.ref).sort(), [field, plot].sort());
  assert.equal(filtered.edges.length, 1);
  assert.equal(filtered.actions.map((action) => action.name).includes('vacp.data_schema'), true);
});

test('graph filter applies node kind filters', () => {
  const data = ref('vacp://example/data');
  const widget = ref('vacp://example/widget');
  const graph: VacpGraph = {
    nodes: [
      { ref: data, kind: 'DataHandle', layer: 'DataLayer', title: 'Data' },
      { ref: widget, kind: 'Widget', layer: 'ConfigLayer', title: 'Widget' },
    ],
    edges: [{ from: widget, to: data, kind: 'controls' }],
    actions: [],
  };

  const filtered = filterVacpGraph(graph, { nodeKinds: new Set(['DataHandle']) });
  assert.deepEqual(
    filtered.nodes.map((node) => node.ref),
    [data],
  );
  assert.equal(filtered.edges.length, 0);
});

test('graph action selection resolves the original action after filtering', () => {
  const plot = ref('vacp://example/plot');
  const other = ref('vacp://example/other');
  const graph: VacpGraph = {
    nodes: [
      { ref: plot, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Plot' },
      { ref: other, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Other' },
    ],
    edges: [],
    actions: [
      { name: 'example.first', description: 'First action.', targetRef: other },
      { name: 'example.second', description: 'Second action.', targetRef: plot, parameters: { default: { ok: true } } },
    ],
  };

  const filtered = filterVacpGraph(graph, { query: 'second' });
  const selected = filtered.actions.map((action, index) => ({ kind: 'action' as const, index, name: action.name }))[0]!;
  const inspector = buildInspectorValue(
    {
      version: '0.1.0',
      runtimeId: 'test',
      mode: 'live',
      cursor: -1,
      history: [],
      liveCapabilities: { version: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z', graph },
      liveState: { version: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z', state: {} },
      currentCapabilities: { version: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z', graph },
      currentState: { version: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z', state: {} },
    },
    selected,
  ) as { name?: string; parameters?: unknown };

  assert.equal(selected.index, 0);
  assert.equal(inspector.name, 'example.second');
  assert.deepEqual(inspector.parameters, { default: { ok: true } });
});
