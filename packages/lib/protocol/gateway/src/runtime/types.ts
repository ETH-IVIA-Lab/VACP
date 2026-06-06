import type { VacpCapabilitiesSnapshot, VacpRuntimeBridge, VacpStateSnapshot } from '@vacp/core';

import type { VacpActionRegistry } from '../action-registry';

export interface VacpSnapshotProvider {
  getCapabilities(): VacpCapabilitiesSnapshot | Promise<VacpCapabilitiesSnapshot>;
  getState(): VacpStateSnapshot | Promise<VacpStateSnapshot>;
}

export type VacpRuntimeBridgeUpdate = {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  /**
   * Optional session identifier for the current attached visualization/view.
   * If this changes, tooling may treat it as a new runtime session.
   */
  sessionKey?: string;
};

/**
 * Optional internal hooks used by `installVacpRuntimeBridge` to keep
 * `window.__vacp` stable across provider re-installs.
 */
export interface VacpUpdatableRuntimeBridge extends VacpRuntimeBridge {
  __vacpUpdate?: (next: VacpRuntimeBridgeUpdate) => void;
  __vacpRuntimeId?: string;
  __vacpSessionKey?: string;
}
