import type {
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpStateRequest,
  VacpRuntimeBridge,
  VacpRuntimeSnapshot,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/core';

export type VacpDebugUiEnabled = boolean | 'auto';

export interface VacpDebugUiOptions {
  /**
   * If `true`, always show the overlay.
   * If `false`, never show it.
   * If `'auto'`, use the VACP debug flag. The flag defaults to on and can be disabled with:
   * - URL: `?vacp-debug=0`
   * - env: `VACP_DEBUG_UI=0`
   * - localStorage: `vacp:debug=0`
   */
  enabled?: VacpDebugUiEnabled;
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  /** Whether to show semantic actions as nodes in diagrams (default: true). */
  includeActions?: boolean;
}

export type VacpWindowBridge = VacpRuntimeBridge & {
  getCapabilities: {
    (): Promise<VacpCapabilitiesSnapshot>;
    (request: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot>;
  };
  getState: {
    (): Promise<VacpStateSnapshot>;
    (request: VacpStateRequest): Promise<VacpStateUpdate>;
  };
  getRuntime?: () => Promise<VacpRuntimeSnapshot>;
};
