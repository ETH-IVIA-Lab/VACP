import { create } from 'zustand';

import type { VacpGraph, VacpRef } from '@vacp/core';

import type { GraphDirection, SelectedGraphItem } from './graph-types';
import { selectedGraphItemKey } from './graph-model';

export type VacpGraphUiState = {
  direction: GraphDirection;
  includeActions: boolean;
  includeActionsTouched: boolean;
  selected: SelectedGraphItem;
  collapsedRefs: ReadonlySet<VacpRef>;
  syncIncludeActionsDefault: (includeActions: boolean) => void;
  toggleDirection: () => void;
  toggleIncludeActions: () => void;
  selectGraphItem: (item: SelectedGraphItem) => void;
  pruneSelectedNodeIds: (nodeIds: ReadonlySet<string>) => void;
  pruneCollapsedRefs: (graph: VacpGraph) => void;
  toggleCollapsedRef: (graph: VacpGraph, ref: VacpRef) => void;
};

function containsChildrenByParent(graph: VacpGraph): Map<VacpRef, VacpRef[]> {
  const children = new Map<VacpRef, VacpRef[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'contains') continue;
    const refs = children.get(edge.from) ?? [];
    refs.push(edge.to);
    children.set(edge.from, refs);
  }
  return children;
}

function refsWithChildren(children: Map<VacpRef, VacpRef[]>): Set<VacpRef> {
  const refs = new Set<VacpRef>();
  for (const [ref, childRefs] of children) {
    if (childRefs.length > 0) refs.add(ref);
  }
  return refs;
}

function descendantParentsFor(graph: VacpGraph, ref: VacpRef): Set<VacpRef> {
  const children = containsChildrenByParent(graph);
  const parents = refsWithChildren(children);
  const descendants = new Set<VacpRef>();
  const stack = [...(children.get(ref) ?? [])];

  while (stack.length > 0) {
    const child = stack.pop();
    if (!child || descendants.has(child)) continue;
    if (parents.has(child)) descendants.add(child);
    stack.push(...(children.get(child) ?? []));
  }

  return descendants;
}

export function nextCollapsedRefsForToggle(
  graph: VacpGraph,
  collapsedRefs: ReadonlySet<VacpRef>,
  ref: VacpRef,
): ReadonlySet<VacpRef> {
  const next = new Set(collapsedRefs);
  if (next.has(ref)) {
    next.delete(ref);
    return next;
  }

  next.add(ref);
  for (const descendant of descendantParentsFor(graph, ref)) {
    next.add(descendant);
  }
  return next;
}

export function pruneCollapsedRefsForGraph(graph: VacpGraph, collapsedRefs: ReadonlySet<VacpRef>): ReadonlySet<VacpRef> {
  const refs = new Set(graph.nodes.map((node) => node.ref));
  const next = new Set([...collapsedRefs].filter((ref) => refs.has(ref)));
  return next.size === collapsedRefs.size ? collapsedRefs : next;
}

export const useVacpGraphUiStore = create<VacpGraphUiState>((set) => ({
  direction: 'LR',
  includeActions: false,
  includeActionsTouched: false,
  selected: null,
  collapsedRefs: new Set(),

  syncIncludeActionsDefault: (includeActions) =>
    set((state) => (state.includeActionsTouched ? state : { includeActions })),

  toggleDirection: () =>
    set((state) => ({
      direction: state.direction === 'LR' ? 'TB' : 'LR',
    })),

  toggleIncludeActions: () =>
    set((state) => ({
      includeActions: !state.includeActions,
      includeActionsTouched: true,
    })),

  selectGraphItem: (item) =>
    set((state) => (selectedGraphItemKey(state.selected) === selectedGraphItemKey(item) ? state : { selected: item })),

  pruneSelectedNodeIds: (nodeIds) =>
    set((state) => {
      const key = selectedGraphItemKey(state.selected);
      if (!key || nodeIds.has(key)) return state;
      return { selected: null };
    }),

  pruneCollapsedRefs: (graph) =>
    set((state) => ({
      collapsedRefs: pruneCollapsedRefsForGraph(graph, state.collapsedRefs),
    })),

  toggleCollapsedRef: (graph, ref) =>
    set((state) => ({
      collapsedRefs: nextCollapsedRefsForToggle(graph, state.collapsedRefs, ref),
    })),
}));
