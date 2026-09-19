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
  graph: VacpGraphFragment<NodeData>;
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
  /** Version of the complete graph, state, summary, and freshness. Computed from content when omitted. */
  revision?: string;
};

/** Bind a pure source description and analytical projector to live operations. */
export function createVacpProvider<NodeData = Record<string, unknown>>(args: {
  source: VacpSourceDescription;
  actions: Pick<VacpActionExecutor, 'prepare'>;
  project: () => VacpAnalyticalProjection<NodeData> | Promise<VacpAnalyticalProjection<NodeData>>;
  subscribe?: (invalidate: () => void) => () => void;
  dispose?: () => void;
}): VacpProvider<NodeData> {
  return {
    source: args.source,
    observe: async () => {
      const projected = await args.project();
      const { graph } = projected;
      const revision =
        projected.revision == null
          ? `src_${fnv1a64Hex(stableStringify({ graph, state: projected.state, summary: projected.summary, freshness: projected.freshness }))}`
          : projected.revision;

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
