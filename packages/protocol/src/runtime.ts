import type {
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpCapabilitiesSnapshot,
  VacpObservation,
  VacpStateSnapshot,
  VacpWindowBridge,
} from './schema';

/** Attribution shared by live execution and observation recording. */
export type VacpChangeSource = 'human' | 'agent' | 'inspector' | 'system';

export type VacpHistoryEntryKind = 'snapshot' | 'action' | 'session';

export type VacpHistoryEntry = {
  id: string;
  at: string;
  kind: VacpHistoryEntryKind;
  source: VacpChangeSource;
  message?: string;
  call?: VacpActionCall;
  result?: VacpActionResult;
  /** Coherent observation captured at this entry for independent inspection. */
  observation?: VacpObservation;
  capabilities?: VacpCapabilitiesSnapshot;
  state?: VacpStateSnapshot;
  /** Optional before/after snapshots for action entries. */
  beforeState?: VacpStateSnapshot;
  afterState?: VacpStateSnapshot;
};

/** Live source state and its recording. Historical selection belongs to the consumer. */
export type VacpRuntimeSnapshot = {
  version: VacpCapabilitiesSnapshot['version'];
  runtimeId?: string;
  sessionKey?: string;
  history: VacpHistoryEntry[];
  observation: VacpObservation;
};

/**
 * Optional live recording and execution capabilities.
 *
 * Runtime instrumentation for in-page tools such as the inspector.
 */
export interface VacpRuntimeBridge extends VacpWindowBridge {
  readonly runtimeId?: string;
  readonly sessionKey?: string;
  getRuntime?: () => Promise<VacpRuntimeSnapshot> | VacpRuntimeSnapshot;
  /**
   * Subscribe to runtime entries. Returns an unsubscribe function.
   * Listeners are only invoked in-page (not over MCP).
   */
  subscribe?: (listener: (entry: VacpHistoryEntry) => void) => () => void;
  /** Capture a fresh state snapshot after human-driven UI changes. */
  refresh?: (options?: { source?: VacpChangeSource; message?: string }) => Promise<VacpStateSnapshot>;
  /**
   * Dispatch an action with an explicit source label for the local runtime
   * timeline. `execute()` remains MCP-friendly and defaults to `source="agent"`.
   */
  dispatch?: (
    call: VacpActionCall,
    options?: VacpActionExecutionOptions & { source?: VacpChangeSource; message?: string },
  ) => Promise<VacpActionResult>;

  /**
   * Optional state observer:
   * - records timeline entries when snapshots change
   * - records human interactions for providers that cannot emit events
   */
  startObserving?: (options?: { intervalMs?: number; source?: VacpChangeSource; message?: string }) => void;
  stopObserving?: () => void;
}
