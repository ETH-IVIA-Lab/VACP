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
 * Minimal structural types for vgplot Plot/Mark/Interactor objects.
 * This keeps `@vacp/adapter-vgplot` usable even if VGPlot types are not installed.
 */
export interface VgplotMarkLike {
  type?: string;
  index?: number;
  sourceTable?: () => string | null;
  channels?: Array<{ channel: string; as?: string; field?: unknown }>;
}

export interface VgplotScaleLike<Value = number | Date> {
  domain?: unknown[] | (() => unknown[]);
  apply(value: Value): number;
}

export interface VgplotSelectionLike<Value = unknown> {
  value?: Value;
  update?: (value: Value) => unknown;
  predicate?: (...args: unknown[]) => unknown;
}

export interface VgplotInteractorLike<Value = unknown> {
  constructor: { name: string };
  value?: Value;
  selection?: VgplotSelectionLike;
  scale?: VgplotScaleLike;
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
  g?: { call(callback: (...args: never[]) => unknown, value: unknown): unknown };
  brush?: { moveSilent: (...args: never[]) => unknown };
  init?: (svg: SVGElement) => unknown;
}

export interface VgplotPlotLike {
  element?: HTMLElement;
  marks: VgplotMarkLike[];
  interactors: VgplotInteractorLike[];
  legends?: Array<{ legend: unknown; include?: boolean } | unknown>;
  setAttribute?: (name: string, value: unknown, options?: { silent?: boolean }) => boolean;
  update?: (...args: unknown[]) => unknown;
  getAttribute?: (name: string) => unknown;
}

/**
 * Structural type for VGPlot/vgplot `table` surfaces.
 *
 * These views are not SVG plots, but they still represent a first-class,
 * interactive surface over a backing DuckDB table (sort + scroll/pagination).
 */
export interface VgplotTableLike {
  constructor?: { name?: string };
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
