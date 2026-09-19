import {
  fnv1a64Hex,
  nowIso,
  stableStringify,
  type VacpFreshness,
  type VacpGraphFragment,
  type VacpProvider,
  type VacpRef,
  type VacpSourceDescription,
} from '@vacp/protocol';
import type { VacpActionExecutor } from './action-registry';

export type VacpAnalyticalProjection<NodeData = Record<string, unknown>> = {
  graph: Omit<VacpGraphFragment<NodeData>, 'actions'>;
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
  /** Version of this projection. The provider also accounts for action catalog changes. */
  revision?: string;
};

/** Bind a pure source description and analytical projector to live operations. */
export function createVacpProvider<NodeData = Record<string, unknown>>(args: {
  source: VacpSourceDescription;
  actions: VacpActionExecutor;
  project: () => VacpAnalyticalProjection<NodeData> | Promise<VacpAnalyticalProjection<NodeData>>;
  subscribe?: (invalidate: () => void) => () => void;
  dispose?: () => void;
}): VacpProvider<NodeData> {
  return {
    source: args.source,
    observe: async () => {
      const projected = await args.project();
      const graph: VacpGraphFragment<NodeData> = { ...projected.graph, actions: args.actions.list() };
      const revision =
        projected.revision == null
          ? `src_${fnv1a64Hex(stableStringify({ graph, state: projected.state, summary: projected.summary, freshness: projected.freshness }))}`
          : `${projected.revision}:${fnv1a64Hex(stableStringify(graph.actions))}`;

      return {
        revision,
        observedAt: nowIso(),
        graph,
        state: projected.state,
        summary: projected.summary,
        freshness: projected.freshness,
      };
    },
    prepare: (call, options) => args.actions.prepare(call, options),
    subscribe: args.subscribe,
    dispose: args.dispose,
  };
}
