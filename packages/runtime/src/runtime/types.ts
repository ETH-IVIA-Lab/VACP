import type { VacpCapabilitiesSnapshot, VacpRuntimeBridge, VacpStateSnapshot, VacpRef } from '@vacp/protocol';

import type { VacpActionExecutor } from '../action-registry';

export interface VacpSnapshotProvider<
  State = Record<VacpRef, unknown>,
  Summary = Record<VacpRef, unknown>,
  NodeData = Record<string, unknown>,
> {
  getCapabilities(): VacpCapabilitiesSnapshot<NodeData> | Promise<VacpCapabilitiesSnapshot<NodeData>>;
  getState(): VacpStateSnapshot<State, Summary> | Promise<VacpStateSnapshot<State, Summary>>;
}

export type VacpRuntimeUpdate = {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionExecutor;
  /**
   * Optional session identifier for the current attached visualization/view.
   * If this changes, tooling may treat it as a new runtime session.
   */
  sessionKey?: string;
};

export interface VacpRuntime extends Required<Omit<VacpRuntimeBridge, 'runtimeId' | 'sessionKey'>> {
  readonly runtimeId: string;
  readonly sessionKey: string | undefined;
  update(next: VacpRuntimeUpdate): void;
  dispose(): void;
}

export type LiveSnapshots = { capabilities: VacpCapabilitiesSnapshot; state: VacpStateSnapshot };
