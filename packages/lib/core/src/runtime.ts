import type {
  VacpActionCall,
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
 * Importantly, this runtime layer is *not MCP-specific*: MCP is just one
 * transport that can read and invoke the protocol surface. The runtime exists
 * in the app, and can be used by humans (debug UI), agents, or other tooling.
 */
export type VacpChangeSource = 'human' | 'agent' | 'debug' | 'system';

export type VacpHistoryEntryKind = 'snapshot' | 'action' | 'state_override' | 'graph_override' | 'mode';

export interface VacpHistoryEntry {
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
}

export type VacpRuntimeMode = 'live' | 'inspect';

export interface VacpRuntimeSnapshot {
  /** Protocol version. */
  version: VacpCapabilitiesSnapshot['version'];
  /** Stable identifier for the in-page runtime instance (debugging only). */
  runtimeId?: string;
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
}

/**
 * Playbooks (concepts).
 *
 * A playbook is a lightweight, provider-supplied sequence of steps (usually
 * actions) that can be stepped through in a debug UI. This makes it easy for
 * new users to understand what "bidirectional" interaction means in practice.
 *
 * Playbooks are optional and meant for examples / development tooling.
 */
export type VacpPlaybookStep = {
  id?: string;
  title: string;
  description?: string;
  /**
   * Action call template (callId will be provided by the caller).
   * If omitted, the step is informational only.
   */
  call?: Omit<VacpActionCall, 'callId'>;
};

export type VacpPlaybook = {
  id: string;
  title: string;
  description?: string;
  steps: VacpPlaybookStep[];
};

/**
 * Optional extended in-page bridge contract for debugging and time travel.
 *
 * This is still VACP (protocol + snapshots + actions), but exposes runtime
 * instrumentation that makes it easy to build tools like a debug overlay.
 */
export interface VacpRuntimeBridge extends VacpWindowBridge {
  getRuntime?: () => Promise<VacpRuntimeSnapshot> | VacpRuntimeSnapshot;
  /** Optional scripted playbooks provided by the app/provider (examples/dev only). */
  getPlaybooks?: () => Promise<VacpPlaybook[]> | VacpPlaybook[];
  /**
   * Subscribe to runtime entries. Returns an unsubscribe function.
   * Listeners are only invoked in-page (not over MCP).
   */
  subscribe?: (listener: (entry: VacpHistoryEntry) => void) => () => void;
  /** Capture a fresh state snapshot (useful on human-driven UI changes). */
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
    options?: { source?: VacpChangeSource; message?: string },
  ) => Promise<VacpActionResult>;

  /**
   * Optional state observer:
   * - records timeline entries when snapshots change
   * - useful when the provider cannot emit events for human interactions
   */
  startObserving?: (options?: { intervalMs?: number; source?: VacpChangeSource; message?: string }) => void;
  stopObserving?: () => void;
}
