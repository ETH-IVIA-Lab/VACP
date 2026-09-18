/**
 * VACP core model (project concepts).
 *
 * VACP gives a visual analytics UI a stable contract for:
 * - Discovery: what exists and what actions are available?
 * - State: what is currently selected/configured?
 * - Control: execute semantic actions (not clicks) with parameters.
 *
 * The canonical shape is: graph + actions + snapshots. Transports and tooling
 * (inspector, MCP, etc.) are adapters on top.
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

/** Stable identity for one analytical source participating in a composed view. */
export type VacpSourceId = `vacp-source://${string}`;

export type VacpSourceDescription<Data = Record<string, unknown>> = {
  id: VacpSourceId;
  /** Open source family, for example `application`, `widget`, or `notebook`. */
  type: string;
  title: string;
  description?: string;
  data?: { [Key in keyof Data]: Data[Key] };
};

/**
 * Semantic layers (not rendering layers).
 *
 * Layers help agents prioritize: configuration vs visual structure vs data vs
 * interaction feedback.
 */
export type VacpCoreLayer =
  | 'ConfigLayer'
  | 'ViewLayer'
  | 'VisualizationLayer'
  | 'DataLayer'
  | 'InteractionFeedbackLayer';

/** Core layers remain recognizable while providers may add domain-specific layers. */
export type VacpLayer = VacpCoreLayer | (string & {});

/**
 * App-agnostic node kinds.
 *
 * Providers can attach additional structured fields in `VacpNode.data` (kept
 * JSON-serializable).
 */
export type VacpCoreNodeKind =
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

/** Core node kinds remain recognizable while providers may add domain-specific kinds. */
export type VacpNodeKind = VacpCoreNodeKind | (string & {});

export type VacpCoreEdgeKind = 'contains' | 'controls' | 'derivedFrom' | 'targets';

/** Relationship vocabulary is extensible without weakening stable ref identity. */
export type VacpEdgeKind = VacpCoreEdgeKind | (string & {});

/**
 * A node in the UI/analytics graph.
 *
 * Prefer small, stable summaries and handles over raw data. Large plots should
 * expose queryable handles instead of embedding complete datasets in the graph.
 */
export type VacpNode<Data = Record<string, unknown>> = {
  ref: VacpRef;
  kind: VacpNodeKind;
  layer: VacpLayer;
  title?: string;
  description?: string;
  data?: { [Key in keyof Data]: Data[Key] };
};

export type VacpEdge = {
  from: VacpRef;
  to: VacpRef;
  kind: VacpEdgeKind;
};

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
export type VacpOperationKind = 'mutation' | 'creation' | 'evaluation' | 'query';

export type VacpOperationResultDescriptor = {
  role: 'state' | 'entity' | 'data' | 'visualization' | 'artifact';
  /** Stable result ref when the entity already exists or has a predictable identity. */
  ref?: VacpRef;
  /** Open semantic kind for results that are created dynamically. */
  kind?: string;
  mediaType?: string;
  description?: string;
};

export type VacpOperationSemantics = {
  kind: VacpOperationKind;
  /** Existing analytical entities whose values are consumed by the operation. */
  inputRefs?: VacpRef[];
  /** Existing analytical entities that may change when the operation succeeds. */
  affects?: VacpRef[];
  /** Parameters whose values are refs resolved only when the operation is called. */
  refParameters?: Array<{ parameter: string; role: 'input' | 'affects' }>;
  /** Values or entities produced by the operation. */
  results?: VacpOperationResultDescriptor[];
};

export type VacpActionDescriptor<Parameters = Record<string, unknown>> = {
  name: string;
  title?: string;
  description: string;
  /** JSON schema-like object, kept intentionally minimal. */
  parameters?: Parameters;
  operation: VacpOperationSemantics;
};

/**
 * Standard action names (protocol-level).
 *
 * `vacp.apply_state` is intentionally broad:
 * - the caller supplies a *desired state map* keyed by `vacp://...` refs
 * - the provider decides how to interpret and apply that state, then reports
 *   refs it could not apply
 *
 * This enables generic tooling (inspectors, transports, tests) without
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

export type VacpDataSqlResult<Row = Record<string, unknown>> =
  | {
      format: 'json';
      /** The SQL after resolving `vacp_handle` / `vacp_all` and applying `maxRows`. */
      resolvedSql: string;
      columns: string[];
      rows: Row[];
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

export type VacpWidgetOption<Value = unknown> = { value: Value; label?: string };

export type VacpWidgetOptionsResult = {
  ref: VacpRef;
  offset: number;
  limit: number;
  count: number;
  truncated: boolean;
  options: VacpWidgetOption[];
};

export type VacpGraph<NodeData = Record<string, unknown>> = {
  version: VacpSchemaVersion;
  sources: VacpSourceDescription[];
  ownership: {
    nodes: Record<VacpRef, VacpSourceId>;
    actions: Record<string, VacpSourceId>;
  };
  nodes: VacpNode<NodeData>[];
  edges: VacpEdge[];
  actions: VacpActionDescriptor[];
};

/** One source's analytical projection before ownership-aware composition. */
export type VacpGraphFragment<NodeData = Record<string, unknown>> = Omit<VacpGraph<NodeData>, 'sources' | 'ownership'>;

export type VacpFreshness = {
  status: 'current' | 'stale' | 'running' | 'error';
  /** Revision of the input state the output is based on. */
  inputRevision?: string;
  /** Revision of the output currently represented by this ref. */
  outputRevision?: string;
  message?: string;
};

/** One coherent view of capabilities, state, and output freshness. */
export type VacpObservation<NodeData = Record<string, unknown>> = {
  version: VacpSchemaVersion;
  revision: string;
  observedAt: string;
  graph: VacpGraph<NodeData>;
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
};

/**
 * Capabilities snapshot: the "what exists / what can I do?" view.
 *
 * This should be safe and cheap to call frequently.
 */
export type VacpCapabilitiesSnapshot<NodeData = Record<string, unknown>> = {
  version: VacpSchemaVersion;
  createdAt: string;
  graph: VacpGraph<NodeData>;
};

export type VacpCapabilitiesRequest = {
  /** Include explicit refs (and optionally intersect with kinds/layers). */
  refs?: VacpRef[];
  /** Include refs that match any stable prefix (e.g. view/viz subtree). */
  prefixes?: VacpRef[];
  /** Optional node-kind filter. */
  kinds?: VacpNodeKind[];
  /** Optional semantic-layer filter. */
  layers?: VacpLayer[];
  /** Include action descriptors in the scoped graph (default: true). */
  includeActions?: boolean;
  /** Include edges where both endpoints survive scoping (default: true). */
  includeEdges?: boolean;
  /** Include node `data` payloads (default: true). */
  includeNodeData?: boolean;
};

/**
 * State snapshot: current values keyed by stable node refs.
 *
 * Selections and params live here, so agents can ask "what is active?"
 * without scraping the DOM.
 */
export type VacpStateSnapshot<State = Record<VacpRef, unknown>, Summary = Record<VacpRef, unknown>> = {
  version: VacpSchemaVersion;
  createdAt: string;
  /** State keyed by node ref (selections, params, etc.). */
  state: { [Ref in keyof State]: State[Ref] };
  /** Optional lightweight summaries keyed by ref (counts, domains, etc.). */
  summary?: { [Ref in keyof Summary]: Summary[Ref] };
};

export type VacpStateRequestMode = 'auto' | 'full' | 'delta';

export type VacpStateRequest = {
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
};

export type VacpStateDeltaPayload = {
  changed: Record<VacpRef, unknown>;
  removed: VacpRef[];
  summaryChanged?: Record<VacpRef, unknown>;
  summaryRemoved?: VacpRef[];
};

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
export type VacpActionCall<Params = unknown, Name extends string = string> = {
  callId: string;
  name: Name;
  params?: Params;
};

export type VacpActionResult<Result = unknown, ErrorDetails = unknown> =
  | { callId: string; ok: true; result?: Result }
  | { callId: string; ok: false; error: { message: string; details?: ErrorDetails } };

/** In-process execution controls; these are not part of the serialized call. */
export type VacpActionExecutionOptions = { signal?: AbortSignal };

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
  /** Canonical atomic read for graph, state, ownership, and freshness. */
  observe(): Promise<VacpObservation> | VacpObservation;
  getCapabilities(request: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot> | VacpCapabilitiesSnapshot;
  getCapabilities(): Promise<VacpCapabilitiesSnapshot> | VacpCapabilitiesSnapshot;
  getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  getState(): Promise<VacpStateSnapshot>;
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
}
