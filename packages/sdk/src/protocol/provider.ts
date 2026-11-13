import type { VacpActionCall, VacpFreshness, VacpGraphFragment, VacpRef, VacpSourceDescription } from './schema';
import type { VacpActionExecutionOptions, VacpPreparedAction } from './execution';

/** Atomic contribution published by one analytical source. */
export type VacpProviderObservation<NodeData = Record<string, unknown>> = {
  /** Changes whenever graph, state, summary, or freshness changes. */
  revision: string;
  observedAt: string;
  graph: VacpGraphFragment<NodeData>;
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
};

/**
 * Effectful binding for a source description and its analytical projection.
 *
 * Discovery adapters create this port. Runtime composition consumes it without
 * knowing whether the source is a chart, widget, notebook, database, or app.
 */
export interface VacpProvider<NodeData = Record<string, unknown>> {
  readonly source: VacpSourceDescription;
  observe(): VacpProviderObservation<NodeData> | Promise<VacpProviderObservation<NodeData>>;
  prepare(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpPreparedAction>;
  /** Notify consumers that a later observation may differ. Unattributed changes are recorded from it. */
  subscribe(invalidate: () => void): () => void;
  dispose?(): void;
}
