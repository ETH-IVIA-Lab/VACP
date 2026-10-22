export const VACP_SCHEMA_VERSION = '0.1.0' as const;

export type VacpSchemaVersion = typeof VACP_SCHEMA_VERSION;

/** Stable node identity derived from the provider's semantic model, never from DOM order. */
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

export type VacpCoreLayer =
  | 'ConfigLayer'
  | 'ViewLayer'
  | 'VisualizationLayer'
  | 'DataLayer'
  | 'InteractionFeedbackLayer';

/** Core layers remain recognizable while providers may add domain-specific layers. */
export type VacpLayer = VacpCoreLayer | (string & {});

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

/** Current host readiness and conjunctive node prerequisites. Omission means available. */
export type VacpAvailability = {
  /** All listed nodes must be available. Cycles and missing refs are invalid. */
  requires?: readonly VacpRef[];
  /** A host-supplied reason this capability cannot currently be used. */
  unavailable?: string;
};

export type VacpNode<Data = Record<string, unknown>> = {
  ref: VacpRef;
  availability?: VacpAvailability;
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
  /** Shared semantic contract, independent of this action's globally unique routing name. */
  contract?: string;
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
  /** Unique execution identity across the composed graph. */
  name: string;
  availability?: VacpAvailability;
  title?: string;
  description: string;
  /** JSON Schema of the action's input. */
  parameters?: Parameters;
  operation: VacpOperationSemantics;
};

/** Applies a desired state keyed by refs. The provider interprets each value and reports refs it skipped. */
export const VACP_APPLY_STATE_ACTION = 'vacp.apply_state' as const;

export type VacpApplyStateParams = {
  /** Desired state keyed by `vacp://...` refs. */
  state: Record<VacpRef, unknown>;
};

/**
 * Runs SQL over a DataHandle. `vacp_handle` names the handle's selected relation and `vacp_all` its
 * unfiltered relation.
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
  /**
   * Output encoding (default: `json`). `arrow_ipc_base64` returns an Arrow IPC stream for programs
   * that call the bridge, and a tool result cuts its text like any long string.
   */
  format?: 'json' | 'arrow_ipc_base64';
  /** Max rows a JSON result returns, at most and by default 500, so one result fits one tool result. */
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

/** Describes a DataHandle's columns and row count, with bounded summaries on request. */
export const VACP_DATA_SCHEMA_ACTION = 'vacp.data_schema' as const;

export type VacpDataSchemaDetail = 'columns' | 'full';

export type VacpDataSchemaParams = {
  /** Which DataHandle to describe (a node ref with `kind: "DataHandle"`). */
  handleRef: VacpRef;
  /**
   * `columns`, the default, reads columns, types, and the row count. `full` adds bounded numeric,
   * temporal, and top-category summaries.
   */
  detail?: VacpDataSchemaDetail;
  /** Rows scanned for `full` summaries, at least 0. Providers may ignore it. */
  sampleRows?: number;
};

export type VacpDataSchemaColumn = {
  name: string;
  type: string;
  /** Present, and true, only for a NOT NULL column. */
  notNull?: true;
  /** Present, and true, only for a primary key column. */
  primaryKey?: true;
};

export type VacpDataSchemaNumericSummary = {
  min: number | null;
  max: number | null;
  avg: number | null;
  /** Present for a column whose bounds read as epoch timestamps, with `minIso` and `maxIso` as dates. */
  unitHint?: 'epoch_ms' | 'epoch_s';
  minIso?: string;
  maxIso?: string;
};

export type VacpDataSchemaTemporalSummary = {
  minIso: string | null;
  maxIso: string | null;
  minEpochMs: number | null;
  maxEpochMs: number | null;
};

/** One relation's columns and row count, with bounded summaries when `detail` is `full`. */
export type VacpDataSchemaTable = {
  table: string;
  rowCount: number | null;
  columns: VacpDataSchemaColumn[];
  numeric?: Record<string, VacpDataSchemaNumericSummary>;
  temporal?: Record<string, VacpDataSchemaTemporalSummary>;
  categoricalTopValues?: Record<string, Array<{ value: string; n: number }>>;
  sampledRows?: number | null;
};

/** The relation `vacp_handle` reads, and under `vacp_all` the relation `vacp_all` reads when that is another. */
export type VacpDataSchemaResult = {
  handleRef: VacpRef;
  detail: VacpDataSchemaDetail;
  vacp_handle: VacpDataSchemaTable;
  vacp_all?: VacpDataSchemaTable;
};

/** Lists a widget's options, so a caller maps labels to values before setting an input. */
export const VACP_WIDGET_OPTIONS_ACTION = 'vacp.widget_options' as const;

export type VacpWidgetOptionsParams = {
  /** Widget vacp:// ref (kind: "Widget"). */
  ref: VacpRef;
  /** Integer offset, at least 0. Defaults to 0. */
  offset?: number;
  /** Integer page size from 1 to 2000. Defaults to 200. */
  limit?: number;
  /** Substring filter over labels and values, at most 200 characters. */
  query?: string;
};

export type VacpWidgetOption<Value = unknown> = { value: Value; label?: string };

export type VacpWidgetOptionsResult =
  | {
      ref: VacpRef;
      offset: number;
      limit: number;
      count: number;
      truncated: boolean;
      options: VacpWidgetOption[];
    }
  | { ref: VacpRef; kind: 'Widget'; readError: string };

export type VacpGraph<NodeData = Record<string, unknown>> = {
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

export type VacpStateSnapshot<State = Record<VacpRef, unknown>, Summary = Record<VacpRef, unknown>> = {
  version: VacpSchemaVersion;
  createdAt: string;
  /** State keyed by node ref (selections, params, etc.). */
  state: { [Ref in keyof State]: State[Ref] };
  /** Optional lightweight summaries keyed by ref (counts, domains, etc.). */
  summary?: { [Ref in keyof Summary]: Summary[Ref] };
};

export type VacpStateRequest = {
  /** Token of an earlier read. Absent or unknown tokens read the full state. */
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
 * What a caller asks the runtime to execute. The runtime assigns `callId` when it is absent, null, or blank and keeps
 * any other as written.
 */
export type VacpActionRequest<Params = unknown, Name extends string = string> = {
  callId?: string | null;
  name: Name;
  params?: Params;
};

/** A request as the runtime executes and records it, with the caller's `callId` or the one it assigned. */
export type VacpActionCall<Params = unknown, Name extends string = string> = VacpActionRequest<Params, Name> & {
  callId: string;
};

export type VacpActionResult<Result = unknown, ErrorDetails = unknown> =
  | { callId: string; ok: true; result?: Result }
  | { callId: string; ok: false; error: { message: string; details?: ErrorDetails } };
