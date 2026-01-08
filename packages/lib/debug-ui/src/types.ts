import type { VacpCapabilitiesSnapshot, VacpPlaybook, VacpRuntimeBridge, VacpRuntimeSnapshot, VacpStateSnapshot } from '@vacp/core';

export type VacpDebugUiEnabled = boolean | 'auto';

export interface VacpDebugUiOptions {
  /**
   * If `true`, always show the overlay.
   * If `false`, never show it.
   * If `'auto'`, enable when `?vacpDebug=1` is present or localStorage has
   * `vacp:debug=1`.
   */
  enabled?: VacpDebugUiEnabled;
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  /** Whether to show semantic actions as nodes in diagrams (default: true). */
  includeActions?: boolean;
}

export type VacpWindowBridge = VacpRuntimeBridge & {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  getState: () => Promise<VacpStateSnapshot>;
  getRuntime?: () => Promise<VacpRuntimeSnapshot>;
  getPlaybooks?: () => Promise<VacpPlaybook[]>;
};
