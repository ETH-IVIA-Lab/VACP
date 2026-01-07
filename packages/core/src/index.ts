/**
 * VACP core model (project concepts).
 *
 * VACP makes a visual analytics UI "agent-ready" by providing a stable contract
 * for:
 * - Discovery: what exists and what actions are available?
 * - State: what is currently selected/configured?
 * - Control: execute semantic actions (not clicks) with parameters.
 *
 * The canonical shape is: graph + actions + snapshots. DOM/SVG annotations and
 * "computer use" are optional adapters on top.
 */
export const VACP_SCHEMA_VERSION = '0.1.0' as const;

export type VacpSchemaVersion = typeof VACP_SCHEMA_VERSION;

/**
 * Stable reference identifier for VACP nodes.
 *
 * Identity must survive rerenders. Avoid DOM scan order. Providers should derive
 * refs from their semantic runtime model (plot ids, mark indices, selection
 * names, etc.).
 */
export type VacpRef = `vacp://${string}`;

/**
 * Semantic layers (not rendering layers).
 *
 * Layers help agents prioritize: configuration vs visual structure vs data vs
 * interaction feedback.
 */
export type VacpLayer = 'ConfigLayer' | 'ViewLayer' | 'VisualizationLayer' | 'DataLayer' | 'InteractionFeedbackLayer';

/**
 * App-agnostic node kinds.
 *
 * Providers can attach additional structured fields in `VacpNode.data` (kept
 * JSON-serializable).
 */
export type VacpNodeKind =
  | 'App'
  | 'View'
  | 'Visualization'
  | 'Mark'
  | 'Legend'
  | 'Axis'
  | 'Selection'
  | 'Param'
  | 'Widget'
  | 'DataHandle'
  | 'InteractionTarget';

export type VacpEdgeKind = 'contains' | 'controls' | 'derivedFrom' | 'targets';

/**
 * A node in the UI/analytics graph.
 *
 * Prefer small, stable summaries and handles over raw data; VACP should avoid
 * "DataLayer explosion" for large plots.
 */
export interface VacpNode {
  ref: VacpRef;
  kind: VacpNodeKind;
  layer: VacpLayer;
  title?: string;
  description?: string;
  data?: Record<string, unknown>;
}

export interface VacpEdge {
  from: VacpRef;
  to: VacpRef;
  kind: VacpEdgeKind;
}

/**
 * A semantic interaction (not a DOM event).
 *
 * Examples:
 * - set brush interval in domain units
 * - clear selection
 * - set axis domain
 * - toggle series visibility
 *
 * The parameter schema is intentionally lightweight: enough for agents and
 * validators, without requiring a specific JSON schema dialect.
 */
export interface VacpActionDescriptor {
  name: string;
  title?: string;
  description: string;
  /** JSON schema-like object, kept intentionally minimal. */
  parameters?: Record<string, unknown>;
  /** Optional stable ref for the target this action acts on. */
  targetRef?: VacpRef;
}

export interface VacpGraph {
  version: VacpSchemaVersion;
  nodes: VacpNode[];
  edges: VacpEdge[];
  actions: VacpActionDescriptor[];
}

/**
 * Capabilities snapshot: the "what exists / what can I do?" view.
 *
 * This should be safe and cheap to call frequently.
 */
export interface VacpCapabilitiesSnapshot {
  version: VacpSchemaVersion;
  createdAt: string;
  graph: VacpGraph;
}

/**
 * State snapshot: current values keyed by stable node refs.
 *
 * This is where selections/params live; it lets agents ask "what is active?"
 * without scraping the DOM.
 */
export interface VacpStateSnapshot {
  version: VacpSchemaVersion;
  createdAt: string;
  /** State keyed by node ref (selections, params, etc.). */
  state: Record<VacpRef, unknown>;
  /** Optional lightweight summaries keyed by ref (counts, domains, etc.). */
  summary?: Record<VacpRef, unknown>;
}

/**
 * Action invocation request.
 *
 * `callId` enables correlating asynchronous execution and results.
 */
export interface VacpActionCall {
  callId: string;
  name: string;
  params?: unknown;
}

export type VacpActionResult =
  | { callId: string; ok: true; result?: unknown }
  | { callId: string; ok: false; error: { message: string; details?: unknown } };

/**
 * In-page bridge contract (preferred integration path).
 *
 * A bridge is:
 * - stable (not DOM-order-dependent),
 * - fast (no full DOM scans),
 * - able to expose non-DOM state (selections, params, summaries).
 *
 * The Python MCP server calls this via Playwright `page.evaluate`.
 */
export interface VacpWindowBridge {
  version: VacpSchemaVersion;
  getCapabilities(): Promise<VacpCapabilitiesSnapshot> | VacpCapabilitiesSnapshot;
  getState(): Promise<VacpStateSnapshot> | VacpStateSnapshot;
  execute(call: VacpActionCall): Promise<VacpActionResult>;
}

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
  version: VacpSchemaVersion;
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
 * Optional extended in-page bridge contract for debugging and time travel.
 *
 * This is still VACP (protocol + snapshots + actions), but exposes runtime
 * instrumentation that makes it easy to build tools like a debug overlay.
 */
export interface VacpRuntimeBridge extends VacpWindowBridge {
  getRuntime?: () => Promise<VacpRuntimeSnapshot> | VacpRuntimeSnapshot;
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
  dispatch?: (call: VacpActionCall, options?: { source?: VacpChangeSource; message?: string }) => Promise<VacpActionResult>;
}

export function isVacpRef(value: unknown): value is VacpRef {
  return typeof value === 'string' && value.startsWith('vacp://');
}

export function nowIso(): string {
  return new Date().toISOString();
}
