import { create } from 'zustand';

import type { VacpGraph, VacpRef } from '@vacp/protocol';

import type { GraphDirection, SelectedGraphItem } from './graph-types';
import { selectedGraphItemKey } from './graph-model';
import { nextCollapsedRefsForToggle, pruneCollapsedRefsForGraph } from './graph-collapse';

export type VacpGraphUiState = {
  direction: GraphDirection;
  includeActionsOverride: boolean | null;
  selected: SelectedGraphItem;
  collapsedRefs: ReadonlySet<VacpRef>;
  toggleDirection: () => void;
  toggleIncludeActions: (defaultValue: boolean) => void;
  selectGraphItem: (item: SelectedGraphItem) => void;
  pruneSelectedNodeIds: (nodeIds: ReadonlySet<string>) => void;
  pruneCollapsedRefs: (graph: VacpGraph) => void;
  toggleCollapsedRef: (graph: VacpGraph, ref: VacpRef) => void;
};

export const useVacpGraphUiStore = create<VacpGraphUiState>((set) => ({
  direction: 'LR',
  includeActionsOverride: null,
  selected: null,
  collapsedRefs: new Set(),

  toggleDirection: () =>
    set((state) => ({
      direction: state.direction === 'LR' ? 'TB' : 'LR',
    })),

  toggleIncludeActions: (defaultValue) =>
    set((state) => ({
      includeActionsOverride: !(state.includeActionsOverride ?? defaultValue),
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
    set((state) => {
      const collapsedRefs = pruneCollapsedRefsForGraph(graph, state.collapsedRefs);

      return collapsedRefs === state.collapsedRefs ? state : { collapsedRefs };
    }),

  toggleCollapsedRef: (graph, ref) =>
    set((state) => ({
      collapsedRefs: nextCollapsedRefsForToggle(graph, state.collapsedRefs, ref),
    })),
}));
