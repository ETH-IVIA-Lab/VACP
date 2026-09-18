import type {
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpFreshness,
  VacpGraphFragment,
  VacpRef,
  VacpSourceDescription,
} from './schema';

/** Atomic contribution published by one analytical source. */
export type VacpProviderObservation<NodeData = Record<string, unknown>> = {
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
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
  /** Notify consumers that a later observation may differ. */
  subscribe?(invalidate: () => void): () => void;
  dispose?(): void;
}
