import type { VacpDemo } from '@vacp/core';

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
  getState?: () => any;
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
   * If true, include a debugging action that allows setting any signal by name.
   * This is powerful but should be used carefully in production UIs.
   */
  includeSetSignalAction?: boolean;
  /** Optional demo scripts for debug tooling. */
  demos?: VacpDemo[];
}
