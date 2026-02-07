import type {
  VacpCapabilitiesSnapshot,
  VacpPlaybook,
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
   * If `'auto'`, enable when one of these is set:
   * - URL: `?vacp-debug=1`
   * - env: `VACP_DEBUG_UI=1`
   * - localStorage: `vacp:debug=1`
   */
  enabled?: VacpDebugUiEnabled;
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  /** Whether to show semantic actions as nodes in diagrams (default: true). */
  includeActions?: boolean;
}

export type VacpWindowBridge = VacpRuntimeBridge & {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  getState: {
    (): Promise<VacpStateSnapshot>;
    (request: VacpStateRequest): Promise<VacpStateUpdate>;
  };
  getRuntime?: () => Promise<VacpRuntimeSnapshot>;
  getPlaybooks?: () => Promise<VacpPlaybook[]>;
};
