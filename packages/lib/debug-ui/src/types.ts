import type {
  VacpCapabilitiesSnapshot,
  VacpDemo,
  VacpRuntimeBridge,
  VacpRuntimeSnapshot,
  VacpStateSnapshot,
} from '@vacp/core';

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
  /** Default diagram direction. */
  direction?: 'LR' | 'TB';
  includeActions?: boolean;
  includeStatePreview?: boolean;
}

export type DebugTab = 'Graph' | 'Data' | 'Actions' | 'History' | 'Demo' | 'JSON';

export type VacpWindowBridge = VacpRuntimeBridge & {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  getState: () => Promise<VacpStateSnapshot>;
  getRuntime?: () => Promise<VacpRuntimeSnapshot>;
  getDemos?: () => Promise<VacpDemo[]>;
};
