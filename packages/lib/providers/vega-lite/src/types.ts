import type { VacpPlaybook } from '@vacp/core';

export interface VegaViewLike {
  /**
   * Vega View API: read or set a signal.
   * - signal(name) -> current value
   * - signal(name, value) -> sets value (requires run/runAsync to apply)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal(name: string, value?: any): any;
  runAsync(): Promise<unknown>;
  /**
   * Vega View API: access a named dataset (by name).
   *
   * Used to clear selection stores robustly without clobbering internal signals.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: (name: string) => any;
  /**
   * Vega View API: apply a changeset to a named dataset.
   * (Typically paired with `vega.changeset()`.)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  change?: (name: string, changeset: any) => any;
  /**
   * Optional Vega View API: subscribe to signal changes.
   * Used to keep the VACP runtime timeline in sync with human interactions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addSignalListener?: (name: string, handler: (name: string, value: any) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeSignalListener?: (name: string, handler: (name: string, value: any) => void) => void;
  /**
   * Optional Vega View API: list available signal names.
   * (Not guaranteed; provider will degrade gracefully.)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getState?: (options?: any) => any;
  /**
   * Optional Vega View API: restore a view state snapshot (signals + data).
   *
   * Used to set interval selection "pixel extent" helper signals (e.g. `brush_x`)
   * so the brush rectangle renders after programmatic actions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setState?: (state: any) => any;
  /**
   * Optional Vega View API: access a named scale function.
   *
   * Used to map selection data extents → pixel extents for interval brushes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scale?: (name: string) => any;
  /**
   * Vega View API: get or set the tooltip handler.
   * - tooltip() -> current handler (or null)
   * - tooltip(handler) -> sets handler (may trigger renderer reset)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tooltip?: (handler?: any) => any;
}

export type VegaLiteParamLike = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bind?: any;
};

export interface VegaLiteSpecLike {
  params?: VegaLiteParamLike[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface InstallVacpOnVegaLiteOptions {
  appId: string;
  viewId: string;
  vizId: string;
  title?: string;
  description?: string;
  globalKey?: string;
  /**
   * Optional DuckDB client to back `vacp.data_sql`.
   *
   * If omitted, the provider will lazily create an in-browser DuckDB (WASM)
   * instance when needed.
   */
  duckdbClient?: import('@vacp/duckdb').VacpDuckDbClient;
  /**
   * Enable the standard `vacp.data_sql` action and a DataHandle node when the
   * spec uses inline `data.values`.
   *
   * Defaults to true.
   */
  enableDuckDbDataHandle?: boolean;
  /**
   * If true, include a debugging action that allows setting any signal by name.
   * This is powerful but should be used carefully in production UIs.
   */
  includeSetSignalAction?: boolean;
  /** Optional playbooks for debug tooling. */
  playbooks?: VacpPlaybook[];
}
