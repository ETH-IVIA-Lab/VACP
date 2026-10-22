import type { VacpProvenanceSource } from './provenance';
import type { VacpAgentActivityControl } from './activity';
import type { VacpActionExecutionOptions, VacpActor, VacpExecutionSource, VacpFocus } from './execution';
import type {
  VacpActionRequest,
  VacpActionResult,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpObservation,
  VacpSchemaVersion,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from './schema';

/** The reads and execution a model reaches through a transport. */
export interface VacpWindowBridge {
  readonly version: VacpSchemaVersion;
  /** One coherent read of graph, state, ownership, and freshness. */
  observe(): Promise<VacpObservation>;
  getCapabilities(request?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot>;
  /** A full update with a token when `since` is absent or unknown, otherwise the changes since that token. */
  getState(request?: VacpStateRequest): Promise<VacpStateUpdate>;
  execute(call: VacpActionRequest, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
}

/**
 * The runtime a page publishes at `window.__vacp` and `getVacpBridge()` returns: model-facing reads and
 * execution, full inspection, the provenance record, agent activity, and the live execution stream.
 */
export interface VacpPageBridge
  extends VacpWindowBridge, VacpProvenanceSource, VacpAgentActivityControl, VacpExecutionSource {
  readonly runtimeId: string;
  readonly sessionKey: string | undefined;
  /** Full catalog and state for inspection. Execution still enforces current availability. */
  inspect(): Promise<VacpObservation>;
  /** Record the current state after a native change, attributed to `actor`, a system actor by default. */
  refresh(options?: { actor?: VacpActor; message?: string; focus?: VacpFocus }): Promise<VacpStateSnapshot>;
}
