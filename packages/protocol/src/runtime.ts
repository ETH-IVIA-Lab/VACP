import type {
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpCapabilitiesSnapshot,
  VacpGraph,
  VacpRef,
  VacpStateSnapshot,
  VacpWindowBridge,
} from './schema';

/**
 * Runtime change tracking (project concepts).
 *
 * VACP as a protocol is intentionally "stateless": snapshots + actions.
 * However, many workflows (debugging, replay, time travel, undo/redo) benefit
 * from a *runtime* that records a timeline of snapshots and action results.
 *
 * The runtime layer is transport-neutral. MCP is one transport that can read
 * and invoke the protocol surface. The runtime exists in the app and can be
 * used by humans (inspector), agents, or other tooling.
 */
export type VacpChangeSource = 'human' | 'agent' | 'inspector' | 'system';

export type VacpHistoryEntryKind = 'snapshot' | 'action' | 'state_override' | 'graph_override' | 'mode';

export type VacpHistoryEntry = {
  id: string;
  at: string;
  kind: VacpHistoryEntryKind;
  source: VacpChangeSource;
  message?: string;
  call?: VacpActionCall;
  result?: VacpActionResult;
  /** Optional snapshot captured at this entry (used for time travel). */
  capabilities?: VacpCapabilitiesSnapshot;
  state?: VacpStateSnapshot;
  /** Optional before/after snapshots for action entries. */
  beforeState?: VacpStateSnapshot;
  afterState?: VacpStateSnapshot;
};

export type VacpRuntimeMode = 'live' | 'inspect';

export type VacpRuntimeSnapshot = {
  /** Protocol version. */
  version: VacpCapabilitiesSnapshot['version'];
  /** Stable identifier for the in-page runtime instance (debugging only). */
  runtimeId?: string;
  /**
   * Optional session identifier for the currently attached visualization/view.
   *
   * When present, tooling can use this to correlate analytics, replays, and
   * history boundaries across view switches.
   */
  sessionKey?: string;
  mode: VacpRuntimeMode;
  cursor: number;
  /** Timeline of observed snapshots and action calls/results. */
  history: VacpHistoryEntry[];
  /** Latest observed capabilities/state from the live app. */
  liveCapabilities: VacpCapabilitiesSnapshot;
  liveState: VacpStateSnapshot;
  /**
   * Current "inspected" capabilities/state (can be overridden for debugging).
   * In `mode="live"` these match the live snapshots.
   */
  currentCapabilities: VacpCapabilitiesSnapshot;
  currentState: VacpStateSnapshot;
};

/**
 * Optional extended in-page bridge contract for debugging and time travel.
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
  /** Switch between live and time-travel inspection. */
  setMode?: (mode: VacpRuntimeMode, options?: { source?: VacpChangeSource; message?: string }) => void;
  /** Move the history cursor (time travel) without mutating the live app. */
  setCursor?: (cursor: number, options?: { source?: VacpChangeSource; message?: string }) => void;
  undo?: (options?: { source?: VacpChangeSource; message?: string }) => void;
  redo?: (options?: { source?: VacpChangeSource; message?: string }) => void;
  /** Override state/graph for inspection (does not affect the live app). */
  setStateOverride?: (
    state: Record<VacpRef, unknown>,
    options?: { source?: VacpChangeSource; message?: string },
  ) => void;
  setGraphOverride?: (graph: VacpGraph, options?: { source?: VacpChangeSource; message?: string }) => void;
  clearOverrides?: (options?: { source?: VacpChangeSource; message?: string }) => void;

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
