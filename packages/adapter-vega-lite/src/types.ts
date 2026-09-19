export interface VegaRuntimeContext {
  signals?: Record<string, unknown>;
  data?: Record<string, unknown>;
  subcontext?: Record<string, VegaRuntimeContext>;
  group?: import('./scene').VegaSceneItem;
  scales?: Record<string, { value: (value: unknown) => number }>;
  setState?: (state: unknown) => void;
}

export interface VegaViewLike {
  addEventListener?: (type: string, handler: (event: Event, item?: unknown) => void) => unknown;
  removeEventListener?: (type: string, handler: (event: Event, item?: unknown) => void) => unknown;
  origin?: () => number[];
  padding?: () => number | { left?: number; top?: number; right?: number; bottom?: number };
  container?: () => HTMLElement | null;
  width?: () => number;
  height?: () => number;
  /**
   * Vega View API: read or set a signal.
   * - signal(name) -> current value
   * - signal(name, value) -> sets value (requires run/runAsync to apply)
   */
  signal(name: string, value?: any): any;
  runAsync(
    encode?: string | null,
    prerun?: (view: VegaViewLike) => void,
    postrun?: (view: VegaViewLike) => void,
  ): Promise<unknown>;
  _runtime?: VegaRuntimeContext;
  _trigger?: boolean;
  scenegraph?: () => object;
  /**
   * Vega View API: access a named dataset (by name).
   *
   * Used to clear selection stores robustly without clobbering internal signals.
   */
  data?: (name: string) => any;
  /**
   * Vega View API: apply a changeset to a named dataset.
   * (Typically paired with `vega.changeset()`.)
   */
  change?: (name: string, changeset: any) => any;
  /**
   * Optional Vega View API: subscribe to signal changes.
   * Used to keep the VACP runtime timeline in sync with human interactions.
   */
  addSignalListener?: (name: string, handler: (name: string, value: any) => void) => void;
  removeSignalListener?: (name: string, handler: (name: string, value: any) => void) => void;
  /**
   * Optional Vega View API for listing available signal names.
   * When absent, the provider skips signal-name discovery.
   */
  getState?: (options?: any) => any;
  /**
   * Optional Vega View API: restore a view state snapshot (signals + data).
   *
   * Used to set interval selection "pixel extent" helper signals (e.g. `brush_x`)
   * so the brush rectangle renders after programmatic actions.
   */
  setState?: (state: any) => any;
  /**
   * Optional Vega View API: access a named scale function.
   *
   * Used to map selection data extents to pixel extents for interval brushes.
   */
  scale?: (name: string) => any;
  /**
   * Vega View API: get or set the tooltip handler.
   * - tooltip() -> current handler (or null)
   * - tooltip(handler) -> sets handler (may trigger renderer reset)
   */
  tooltip?: (handler?: any) => any;
}

export type VegaLiteParamLike = {
  name: string;
  value?: any;
  select?: any;
  bind?: any;
};

export interface VegaLiteSpecLike {
  params?: VegaLiteParamLike[];
  [key: string]: any;
}

export interface VegaLiteProviderOptions {
  appId: string;
  viewId: string;
  vizId: string;
  title?: string;
  description?: string;
  enableSql?: boolean;
  /**
   * Optional DuckDB client to back `vacp.data_sql`.
   *
   * If omitted, the provider will lazily create an in-browser DuckDB (WASM)
   * instance when needed.
   */
  duckdbClient?: import('@vacp/data-duckdb').VacpDuckDbClient;
  /**
   * Enable the standard `vacp.data_sql` action and a DataHandle node when the
   * spec uses inline `data.values`.
   *
   * Defaults to true.
   */
  enableDuckDbDataHandle?: boolean;
  /**
   * If true, include a debugging action that allows setting any signal by name.
   * Keep this disabled in production UIs unless arbitrary signal writes are part
   * of the intended control surface.
   */
  includeSetSignalAction?: boolean;
}
