/**
 * VACP core model (project concepts).
 *
 * VACP makes a visual analytics UI "agent-ready" by providing a stable contract
 * for:
 * - Discovery: what exists and what actions are available?
 * - State: what is currently selected/configured?
 * - Control: execute semantic actions (not clicks) with parameters.
 *
 * The canonical shape is: graph + actions + snapshots. Transports and tooling
 * (debug UI, MCP, etc.) are adapters on top.
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
  | 'EncodingChannel'
  | 'EncodedField'
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

/**
 * Standard action names (protocol-level).
 *
 * `vacp.apply_state` is intentionally high-level and powerful:
 * - the caller supplies a *desired state map* keyed by `vacp://...` refs
 * - the provider decides how to interpret and apply that state (best-effort)
 *
 * This enables generic tooling (debug overlays, transports, tests) without
 * hardcoding provider-specific action names.
 */
export const VACP_APPLY_STATE_ACTION = 'vacp.apply_state' as const;

export type VacpApplyStateParams = {
  /** Desired state keyed by `vacp://...` refs. */
  state: Record<VacpRef, unknown>;
};

/**
 * Standard action: run a DuckDB SQL query over a VACP DataHandle.
 *
 * This is the primary "data access" mechanism in this repo:
 * - the app keeps its data in an in-browser DuckDB (WASM) database
 * - the VACP graph exposes DataHandle nodes that map to DuckDB relations
 * - callers run SQL against those handles using this action
 *
 * The SQL string can reference two reserved identifiers:
 * - `vacp_handle`: the handle's *selected* relation
 * - `vacp_all`: the handle's *unfiltered/base* relation
 */
export const VACP_DATA_SQL_ACTION = 'vacp.data_sql' as const;

export type VacpDataSqlParams = {
  /** Which DataHandle to query (a node ref with `kind: "DataHandle"`). */
  handleRef: VacpRef;
  /**
   * SQL query to run. Use `vacp_handle` and/or `vacp_all` to reference the
   * selected or unfiltered relation for the handle.
   */
  sql: string;
  /** Output encoding (default: `json`). */
  format?: 'json' | 'arrow_ipc_base64';
  /**
   * Max rows to return when `format="json"` (default: 500).
   * Set a higher number for larger extracts or use `arrow_ipc_base64`.
   */
  maxRows?: number;
};

export type VacpDataSqlResult =
  | {
      format: 'json';
      /** The SQL after resolving `vacp_handle` / `vacp_all` and applying `maxRows`. */
      resolvedSql: string;
      columns: string[];
      rows: Record<string, unknown>[];
      truncated: boolean;
    }
  | {
      format: 'arrow_ipc_base64';
      /** The SQL after resolving `vacp_handle` / `vacp_all`. */
      resolvedSql: string;
      arrowIpcBase64: string;
    };

/**
 * Standard action: return schema (and optional lightweight summaries) for a DataHandle.
 *
 * This is meant to reduce SQL trial-and-error:
 * agents can ask "what columns exist and what types are they?" before writing queries.
 */
export const VACP_DATA_SCHEMA_ACTION = 'vacp.data_schema' as const;

export type VacpDataSchemaDetail = 'columns' | 'full';

export type VacpDataSchemaParams = {
  /** Which DataHandle to describe (a node ref with `kind: "DataHandle"`). */
  handleRef: VacpRef;
  /**
   * Level of detail:
   * - `columns` (default): columns + types + row count (fast)
   * - `full`: include bounded summaries (numeric/temporal/top categories), tuned for agent context
   */
  detail?: VacpDataSchemaDetail;
  /**
   * When `detail="full"`, bound the amount of data scanned for summaries.
   * Providers may ignore this when unsupported.
   */
  sampleRows?: number;
};

export type VacpDataSchemaColumn = {
  name: string;
  type: string;
  notNull?: boolean;
  primaryKey?: boolean;
};

export type VacpDataSchemaNumericSummary = {
  min: number | null;
  max: number | null;
  avg: number | null;
  unitHint?: 'epoch_ms' | 'epoch_s' | null;
  minIso?: string | null;
  maxIso?: string | null;
};

export type VacpDataSchemaTemporalSummary = {
  minIso: string | null;
  maxIso: string | null;
  minEpochMs: number | null;
  maxEpochMs: number | null;
};

export type VacpDataSchemaResult = {
  handleRef: VacpRef;
  detail: VacpDataSchemaDetail;
  /** Underlying provider table/view name when available. */
  table: string | null;
  rowCount: number | null;
  columns: VacpDataSchemaColumn[];
  numeric?: Record<string, VacpDataSchemaNumericSummary>;
  temporal?: Record<string, VacpDataSchemaTemporalSummary>;
  categoricalTopValues?: Record<string, Array<{ value: string; n: number }>>;
  sampledRows?: number | null;
};

/**
 * Standard action: list options for a Widget ref (e.g., Menu inputs).
 *
 * This lets agents map from human-readable labels to stable values/indices
 * before calling provider-specific input actions.
 */
export const VACP_WIDGET_OPTIONS_ACTION = 'vacp.widget_options' as const;

export type VacpWidgetOptionsParams = {
  /** Widget vacp:// ref (kind: "Widget"). */
  ref: VacpRef;
  /** Pagination offset (default: 0). */
  offset?: number;
  /** Max options to return (default: 200). */
  limit?: number;
  /** Optional substring filter applied to label/value. */
  query?: string;
};

export type VacpWidgetOption = { value: unknown; label?: string };

export type VacpWidgetOptionsResult = {
  ref: VacpRef;
  offset: number;
  limit: number;
  count: number;
  truncated: boolean;
  options: VacpWidgetOption[];
};

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

export type VacpStateRequestMode = 'auto' | 'full' | 'delta';

export interface VacpStateRequest {
  /**
   * Retrieval mode:
   * - `full`: always return a scoped full snapshot envelope.
   * - `delta`: return a delta when `since` is known, else fallback to full.
   * - `auto` (default): choose delta when possible, else full.
   */
  mode?: VacpStateRequestMode;
  /** Baseline token from a previous state-update response. */
  since?: string;
  /** Optional scope: include only these refs in full/delta computation. */
  refs?: VacpRef[];
  /** Include per-ref summaries when available (default: true). */
  includeSummary?: boolean;
}

export interface VacpStateDeltaPayload {
  changed: Record<VacpRef, unknown>;
  removed: VacpRef[];
  summaryChanged?: Record<VacpRef, unknown>;
  summaryRemoved?: VacpRef[];
}

export type VacpStateUpdate =
  | {
      version: VacpSchemaVersion;
      createdAt: string;
      mode: 'full';
      token: string;
      scope?: { refs?: VacpRef[] };
      snapshot: VacpStateSnapshot;
    }
  | {
      version: VacpSchemaVersion;
      createdAt: string;
      mode: 'delta';
      token: string;
      baseToken: string;
      scope?: { refs?: VacpRef[] };
      delta: VacpStateDeltaPayload;
    };

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
  getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  getState(): Promise<VacpStateSnapshot>;
  execute(call: VacpActionCall): Promise<VacpActionResult>;
}
