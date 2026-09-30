/**
 * VGPlot/vgplot provider (project concepts).
 *
 * vgplot is a semantic runtime (marks, selections, interactors, widgets).
 * The provider exposes that runtime as a stable, agent-friendly protocol:
 * - VACP graph (what exists)
 * - VACP state snapshots (what is active)
 * - semantic actions (what can be done)
 */

/**
 * Structural views of the Mosaic objects the provider reads and writes. Which class an
 * object is comes from `native-classes`, never from these shapes.
 */
export interface VgplotMarkLike {
  type?: string;
  index?: number;
  sourceTable?: () => string | null;
  channels?: Array<{ channel: string; as?: string; field?: unknown }>;
}

export interface VgplotScaleLike<Value = number | Date> {
  /** Plot's scale type. Dates read in UTC unless it is `time`. */
  type?: string;
  domain?: unknown[] | (() => unknown[]);
  apply(value: Value): number;
}

export interface VgplotSelectionLike<Value = unknown> {
  readonly active?: { source?: unknown };
  value?: Value;
  single?: boolean;
  valueFor?: (source: VgplotInteractorLike) => unknown;
  update?: (value: Value) => unknown;
  pending?: (type: string) => Promise<unknown>;
  predicate?: (...args: unknown[]) => unknown;
}

export interface VgplotInteractorLike<Value = unknown> {
  channel?: string;
  value?: Value;
  selection?: VgplotSelectionLike;
  scale?: VgplotScaleLike;
  svg?: { scale(axis: 'x' | 'y'): VgplotScaleLike | undefined };
  xscale?: VgplotScaleLike;
  yscale?: VgplotScaleLike;
  xsel?: VgplotSelectionLike;
  ysel?: VgplotSelectionLike;
  x?: unknown;
  y?: unknown;
  xfield?: unknown;
  yfield?: unknown;
  clause?: (value: unknown, field?: unknown, scale?: unknown) => unknown;
  publish?: (value: unknown) => unknown;
  g?: { call(callback: (...args: never[]) => unknown, value: unknown): unknown; nodes?: () => SVGGraphicsElement[] };
  brush?: { moveSilent: (...args: never[]) => unknown };
  init?: (svg: SVGElement) => unknown;
}

export interface VgplotPlotLike {
  pending?: (...args: unknown[]) => unknown;
  render?: (...args: unknown[]) => unknown;
  element?: HTMLElement;
  marks: VgplotMarkLike[];
  interactors: VgplotInteractorLike[];
  legends?: Array<{ legend: unknown; include?: boolean } | unknown>;
  setAttribute?: (name: string, value: unknown, options?: { silent?: boolean }) => boolean;
  update?: (...args: unknown[]) => unknown;
  getAttribute?: (name: string) => unknown;
}

export interface VgplotLegendLike {
  channel: string;
  handler?: VgplotInteractorLike | null;
  selection?: VgplotSelectionLike;
  element?: HTMLElement;
  legend?: Element | null;
}

/**
 * Structural type for VGPlot/vgplot `table` surfaces.
 *
 * These views are not SVG plots, but they still represent a first-class,
 * interactive surface over a backing DuckDB table (sort + scroll/pagination).
 */
export interface VgplotTableLike {
  schema?: Array<{ column: string }>;
  readonly pending?: Promise<unknown>;
  sortHeader?: HTMLElement | null;
  element?: HTMLElement;
  from?: string;
  columns?: unknown;
  offset?: number;
  limit?: number;
  sortColumn?: string | null;
  sortDesc?: boolean;
  selection?: {
    value?: unknown;
    update?: (...args: unknown[]) => unknown;
    predicate?: (...args: unknown[]) => unknown;
  };
  update?: (...args: unknown[]) => unknown;
  requestData?: (...args: unknown[]) => unknown | Promise<unknown>;
}

export interface VgplotProviderOptions {
  appId: string;
  viewId: string;
  title?: string;
  description?: string;
  enableSql?: boolean;
  /**
   * Optional DuckDB client to back the standard `vacp.data_sql` action.
   *
   * If omitted, this provider will still expose selections/actions, but callers
   * won't be able to query selected rows via SQL.
   */
  duckdbClient?: import('@vacp/data-duckdb').VacpDuckDbClient;
}
