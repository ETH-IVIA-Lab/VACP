import {
  operationRefs,
  primaryOperationRef,
  type VacpActionDescriptor,
  type VacpEdge,
  type VacpEdgeKind,
  type VacpGraph,
  type VacpNodeKind,
  type VacpNode,
  type VacpRef,
  type VacpRuntimeSnapshot,
} from '@vacp/protocol';
import { MarkerType, Position } from '@xyflow/react';

import type { GraphDirection, SelectedGraphItem, VacpFlowEdge, VacpFlowNode, VacpGraphCounts } from './graph-types';
import { containsChildrenByParent, descendantsFor, hiddenRefsForCollapse } from './graph-collapse';

const NODE_WIDTH = 280;

const NODE_HEIGHT = 112;

const ACTION_WIDTH = 238;

const ACTION_HEIGHT = 74;

const LR_COLUMN_GAP = 370;

const LR_ROW_GAP = 148;

const TB_COLUMN_GAP = 318;

const TB_ROW_GAP = 172;

const ACTION_COLUMN_GAP = 28;

export function shortRef(ref: VacpRef): string {
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;

  const parts = clean
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .filter((p) => p !== 'vacp:');

  return parts.slice(-3).join('/');
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function selectedGraphItemKey(item: SelectedGraphItem): string | null {
  if (!item) return null;

  return item.kind === 'node' ? nodeId(item.ref) : actionId(item.index, item.name);
}

export function nodeId(ref: VacpRef): string {
  return `node:${ref}`;
}

export function actionId(index: number, actionName: string): string {
  return `action:${actionName}`;
}

function textMatches(value: unknown, query: string): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase().includes(query);
  }

  if (Array.isArray(value)) return value.some((item) => textMatches(item, query));

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => key.toLowerCase().includes(query) || textMatches(entry, query),
    );
  }

  return false;
}

function nodeMatchesQuery(node: VacpNode, query: string): boolean {
  return (
    node.ref.toLowerCase().includes(query) ||
    node.kind.toLowerCase().includes(query) ||
    node.layer.toLowerCase().includes(query) ||
    (node.title ?? '').toLowerCase().includes(query) ||
    (node.description ?? '').toLowerCase().includes(query) ||
    textMatches(node.data, query)
  );
}

function actionMatchesQuery(action: VacpActionDescriptor, query: string): boolean {
  return (
    action.name.toLowerCase().includes(query) ||
    (action.title ?? '').toLowerCase().includes(query) ||
    (action.description ?? '').toLowerCase().includes(query) ||
    operationRefs(action).some((ref) => ref.toLowerCase().includes(query)) ||
    textMatches(action.parameters, query)
  );
}

function neighborRefs(graph: VacpGraph, refs: ReadonlySet<VacpRef>): Set<VacpRef> {
  const next = new Set(refs);

  for (const edge of graph.edges) {
    if (refs.has(edge.from) || refs.has(edge.to)) {
      next.add(edge.from);
      next.add(edge.to);
    }
  }

  return next;
}

export function filterVacpGraph(
  graph: VacpGraph,
  options: {
    query?: string;
    nodeKinds?: ReadonlySet<VacpNodeKind>;
    focus?: SelectedGraphItem;
  },
): VacpGraph {
  const query = options.query?.trim().toLowerCase() ?? '';
  const nodeKinds = options.nodeKinds ?? new Set<VacpNodeKind>();
  const hasKindFilter = nodeKinds.size > 0;
  const focus = options.focus;

  if (!query && !hasKindFilter && !focus) return graph;

  let allowedRefs = new Set(graph.nodes.map((node) => node.ref));

  if (query) {
    const matches = new Set(graph.nodes.filter((node) => nodeMatchesQuery(node, query)).map((node) => node.ref));

    for (const action of graph.actions) {
      if (actionMatchesQuery(action, query)) operationRefs(action).forEach((ref) => matches.add(ref));
    }

    allowedRefs = neighborRefs(graph, matches);
  }

  if (focus?.kind === 'node') {
    allowedRefs = neighborRefs(graph, new Set([focus.ref]));
  } else if (focus?.kind === 'action') {
    const action = graph.actions.find((candidate) => candidate.name === focus.name) ?? graph.actions[focus.index];
    allowedRefs = action ? neighborRefs(graph, new Set(operationRefs(action))) : new Set();
  }

  const nodes = graph.nodes.filter((node) => allowedRefs.has(node.ref) && (!hasKindFilter || nodeKinds.has(node.kind)));
  const visibleRefs = new Set(nodes.map((node) => node.ref));
  const edges = graph.edges.filter((edge) => visibleRefs.has(edge.from) && visibleRefs.has(edge.to));

  const actions = graph.actions.filter((action, index) => {
    if (focus?.kind === 'action')
      return action.name === focus.name || (action.name !== focus.name && index === focus.index);

    const refs = operationRefs(action);
    if (query && !actionMatchesQuery(action, query) && !refs.some((ref) => visibleRefs.has(ref))) return false;

    if (focus?.kind === 'node' && !refs.includes(focus.ref)) return false;

    return !refs.length || refs.some((ref) => visibleRefs.has(ref));
  });

  return { ...graph, nodes, edges, actions };
}

export function nodeKindCounts(graph: VacpGraph): Array<{ kind: VacpNodeKind; count: number }> {
  const counts = new Map<VacpNodeKind, number>();

  for (const node of graph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);

  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

function displayTitle(node: VacpNode): string {
  return node.title || shortRef(node.ref) || node.kind;
}

function visibleGraphEdges(
  edges: VacpEdge[],
  hiddenRefs: ReadonlySet<VacpRef>,
  collapsedRefs: ReadonlySet<VacpRef>,
): VacpEdge[] {
  return edges.filter(
    (edge) =>
      !hiddenRefs.has(edge.from) &&
      !hiddenRefs.has(edge.to) &&
      !(edge.kind === 'contains' && collapsedRefs.has(edge.from)),
  );
}

function visibleGraphNodes(nodes: VacpNode[], hiddenRefs: ReadonlySet<VacpRef>): VacpNode[] {
  return nodes.filter((node) => !hiddenRefs.has(node.ref));
}

function graphLayers(nodes: VacpNode[], edges: VacpEdge[]): Map<VacpRef, number> {
  const visibleRefs = new Set(nodes.map((node) => node.ref));
  const indegree = new Map<VacpRef, number>();
  const outgoing = new Map<VacpRef, VacpRef[]>();

  for (const node of nodes) indegree.set(node.ref, 0);

  for (const edge of edges) {
    if (!visibleRefs.has(edge.from) || !visibleRefs.has(edge.to)) continue;
    const outgoingRefs = outgoing.get(edge.from) ?? [];
    outgoingRefs.push(edge.to);
    outgoing.set(edge.from, outgoingRefs);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes.flatMap((node) => ((indegree.get(node.ref) ?? 0) === 0 ? [node.ref] : []));
  const depth = new Map<VacpRef, number>();

  for (const ref of queue) depth.set(ref, 0);

  for (let i = 0; i < queue.length; i++) {
    const ref = queue[i]!;
    const nextDepth = (depth.get(ref) ?? 0) + 1;

    for (const child of outgoing.get(ref) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, nextDepth));
      indegree.set(child, (indegree.get(child) ?? 1) - 1);

      if ((indegree.get(child) ?? 0) === 0) queue.push(child);
    }
  }

  for (const node of nodes) {
    if (!depth.has(node.ref)) depth.set(node.ref, 0);
  }

  return depth;
}

function positionFor(indexInLayer: number, layer: number, direction: GraphDirection): { x: number; y: number } {
  if (direction === 'TB') {
    return { x: indexInLayer * TB_COLUMN_GAP, y: layer * TB_ROW_GAP };
  }

  return { x: layer * LR_COLUMN_GAP, y: indexInLayer * LR_ROW_GAP };
}

function actionPosition(
  indexInLane: number,
  direction: GraphDirection,
  bounds: { maxX: number; maxY: number },
): { x: number; y: number } {
  if (direction === 'TB') {
    return {
      x: bounds.maxX + NODE_WIDTH + 72,
      y: indexInLane * (ACTION_HEIGHT + ACTION_COLUMN_GAP),
    };
  }

  return {
    x: indexInLane * (ACTION_WIDTH + ACTION_COLUMN_GAP),
    y: bounds.maxY + NODE_HEIGHT + 72,
  };
}

function edgeClass(kind: VacpEdgeKind | 'targets'): string {
  return `vacp-inspector-flow-edge vacp-inspector-flow-edge-${kind}`;
}

function graphEdge(edge: VacpEdge, index: number, direction: GraphDirection): VacpFlowEdge {
  return {
    id: `edge:${edge.from}:${edge.to}:${edge.kind}:${index}`,
    source: nodeId(edge.from),
    target: nodeId(edge.to),
    sourceHandle: direction === 'TB' ? 'source-bottom' : 'source-right',
    targetHandle: direction === 'TB' ? 'target-top' : 'target-left',
    type: 'smoothstep',
    label: edge.kind,
    data: { kind: edge.kind },
    className: edgeClass(edge.kind),
    markerEnd: { type: MarkerType.ArrowClosed },
    selectable: false,
    focusable: false,
    interactionWidth: 0,
    ariaRole: 'presentation',
    domAttributes: { 'aria-hidden': true },
  };
}

function actionEdge(action: VacpActionDescriptor, index: number, direction: GraphDirection): VacpFlowEdge | null {
  const primaryRef = primaryOperationRef(action);
  if (!primaryRef) return null;

  return {
    id: `action-edge:${index}:${action.name}:${primaryRef}`,
    source: actionId(index, action.name),
    target: nodeId(primaryRef),
    sourceHandle: direction === 'TB' ? 'source-left' : 'source-top',
    targetHandle: direction === 'TB' ? 'target-right' : 'target-bottom',
    type: 'smoothstep',
    label: 'targets',
    data: { kind: 'targets' },
    className: edgeClass('targets'),
    markerEnd: { type: MarkerType.ArrowClosed },
    selectable: false,
    focusable: false,
    interactionWidth: 0,
    ariaRole: 'presentation',
    domAttributes: { 'aria-hidden': true },
  };
}

export function buildVacpFlowGraph(args: {
  graph: VacpGraph;
  direction: GraphDirection;
  includeActions: boolean;
  collapsedRefs: ReadonlySet<VacpRef>;
  selected: SelectedGraphItem;
  onToggleCollapse: (ref: VacpRef) => void;
  onSelect: (item: Exclude<SelectedGraphItem, null>) => void;
}): { nodes: VacpFlowNode[]; edges: VacpFlowEdge[]; counts: VacpGraphCounts } {
  const { graph, direction, includeActions, collapsedRefs, selected, onToggleCollapse, onSelect } = args;
  const children = containsChildrenByParent(graph.edges);
  const hiddenRefs = hiddenRefsForCollapse(graph.nodes, collapsedRefs, children);
  const nodes = visibleGraphNodes(graph.nodes, hiddenRefs);
  const edges = visibleGraphEdges(graph.edges, hiddenRefs, collapsedRefs);
  const depth = graphLayers(nodes, edges);
  const selectedKey = selectedGraphItemKey(selected);
  const nodesByLayer = new Map<number, VacpNode[]>();

  for (const node of nodes) {
    const layer = depth.get(node.ref) ?? 0;
    const layerNodes = nodesByLayer.get(layer) ?? [];
    layerNodes.push(node);
    nodesByLayer.set(layer, layerNodes);
  }

  const nodePositions = new Map<VacpRef, { x: number; y: number }>();
  const flowNodes: VacpFlowNode[] = [];

  for (const [layer, layerNodes] of [...nodesByLayer.entries()].sort((a, b) => a[0] - b[0])) {
    layerNodes.forEach((node, indexInLayer) => {
      const position = positionFor(indexInLayer, layer, direction);
      nodePositions.set(node.ref, position);
      const childRefs = children.get(node.ref) ?? [];
      const collapsedCount = [...descendantsFor(node.ref, children)].filter((ref) => hiddenRefs.has(ref)).length;
      const selectedNode = selectedKey === nodeId(node.ref);
      flowNodes.push({
        id: nodeId(node.ref),
        type: 'vacpGraphNode',
        position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        sourcePosition: direction === 'TB' ? Position.Bottom : Position.Right,
        targetPosition: direction === 'TB' ? Position.Top : Position.Left,
        data: {
          item: { kind: 'node', ref: node.ref },
          graphKind: 'node',
          title: displayTitle(node),
          subtitle: shortRef(node.ref),
          meta: `${node.kind} / ${node.layer}`,
          description: node.description ?? null,
          nodeKind: node.kind,
          layer: node.layer,
          selected: selectedNode,
          hasChildren: childRefs.length > 0,
          collapsed: collapsedRefs.has(node.ref),
          collapsedCount,
          onToggleCollapse,
          onSelect,
        },
      });
    });
  }

  const flowEdges = edges.map((edge, index) => graphEdge(edge, index, direction));

  const bounds = [...nodePositions.values()].reduce(
    (current, position) => ({
      maxX: Math.max(current.maxX, position.x),
      maxY: Math.max(current.maxY, position.y),
    }),
    { maxX: 0, maxY: 0 },
  );

  if (includeActions) {
    let actionLaneIndex = 0;
    graph.actions.forEach((action, index) => {
      const primaryRef = primaryOperationRef(action);
      if (primaryRef && hiddenRefs.has(primaryRef)) return;
      const position = actionPosition(actionLaneIndex++, direction, bounds);
      const id = actionId(index, action.name);
      flowNodes.push({
        id,
        type: 'vacpGraphNode',
        position,
        width: ACTION_WIDTH,
        height: ACTION_HEIGHT,
        sourcePosition: direction === 'TB' ? Position.Left : Position.Top,
        targetPosition: direction === 'TB' ? Position.Right : Position.Bottom,
        data: {
          item: { kind: 'action', index, name: action.name },
          graphKind: 'action',
          title: action.title || action.name,
          subtitle: '',
          meta: 'Action',
          description: null,
          nodeKind: 'Action',
          layer: 'ActionLayer',
          selected: selectedKey === id,
          hasChildren: false,
          collapsed: false,
          collapsedCount: 0,
          onToggleCollapse: null,
          onSelect,
        },
      });

      const edge = actionEdge(action, index, direction);

      if (edge) flowEdges.push(edge);
    });
  }

  return {
    nodes: flowNodes,
    edges: flowEdges,
    counts: {
      visibleNodes: nodes.length,
      hiddenNodes: hiddenRefs.size,
      visibleEdges: flowEdges.length,
    },
  };
}

export function buildInspectorValue(runtime: VacpRuntimeSnapshot, selected: SelectedGraphItem) {
  if (!selected) return null;
  const graph = runtime.currentCapabilities.graph;

  if (selected.kind === 'action') {
    const action = graph.actions.find((candidate) => candidate.name === selected.name) ?? graph.actions[selected.index];
    const sourceId = action ? graph.ownership.actions[action.name] : undefined;

    return action
      ? {
          kind: 'action',
          name: action.name,
          description: action.description ?? null,
          operation: action.operation,
          source: graph.sources.find((source) => source.id === sourceId) ?? null,
          parameters: action.parameters ?? {},
        }
      : { error: 'Unknown action', index: selected.index, name: selected.name };
  }

  const node = graph.nodes.find((candidate) => candidate.ref === selected.ref);

  if (!node) return { error: 'Unknown node', ref: selected.ref };
  const stateValue = runtime.currentState.state[node.ref];
  const sourceId = graph.ownership.nodes[node.ref];
  const targeting = graph.actions.filter((action) => operationRefs(action).includes(node.ref));
  const connectedEdges = graph.edges.filter((edge) => edge.from === node.ref || edge.to === node.ref);

  return {
    kind: 'node',
    ref: node.ref,
    shortRef: shortRef(node.ref),
    nodeKind: node.kind,
    layer: node.layer,
    title: node.title ?? null,
    description: node.description ?? null,
    data: node.data ?? null,
    state: stateValue ?? null,
    freshness: runtime.currentObservation.freshness?.[node.ref] ?? null,
    source: graph.sources.find((source) => source.id === sourceId) ?? null,
    actions: targeting.map((action) => action.name),
    edges: connectedEdges,
  };
}
