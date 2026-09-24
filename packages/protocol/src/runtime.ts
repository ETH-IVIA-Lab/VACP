import type { VacpProvenanceSource } from './provenance';
import type { VacpActor, VacpFocus } from './execution';
import type {
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpObservation,
  VacpStateSnapshot,
  VacpWindowBridge,
} from './schema';

/**
 * Optional live recording and execution capabilities.
 *
 * Runtime instrumentation for in-page tools such as the inspector.
 */
export interface VacpRuntimeBridge extends VacpWindowBridge, VacpProvenanceSource {
  /** Full catalog and state for inspection. Execution still enforces current availability. */
  inspect(): Promise<VacpObservation> | VacpObservation;
  readonly runtimeId?: string;
  readonly sessionKey?: string;
  /** Capture a fresh state snapshot after human-driven UI changes. */
  refresh?: (options?: { actor?: VacpActor; message?: string; focus?: VacpFocus }) => Promise<VacpStateSnapshot>;
  /**
   * Dispatch an action with an explicit actor for the local runtime
   * timeline. `execute()` remains MCP-friendly and defaults to an agent actor.
   */
  dispatch?: (call: VacpActionCall, options?: VacpActionExecutionOptions) => Promise<VacpActionResult>;

  /**
   * Optional state observer:
   * - records timeline entries when snapshots change
   * - records unattributed changes as system observations unless the host supplies an actor
   */
  startObserving?: (options?: { intervalMs?: number; actor?: VacpActor; message?: string }) => void;
  stopObserving?: () => void;
}
