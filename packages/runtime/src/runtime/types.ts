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
  /** Aborted when this runtime is disposed. */
  readonly signal: AbortSignal;
  readonly runtimeId: string;
  readonly sessionKey: string | undefined;
  update(next: VacpRuntimeUpdate): void;
  /** Live graph changes, independent of history and inspection overrides. */
  subscribeCapabilities(listener: (snapshot: VacpCapabilitiesSnapshot) => void): () => void;
  /** Live snapshots for output adapters, independent of the history stream. */
  subscribeSnapshots(listener: (snapshots: VacpLiveSnapshots) => void): () => void;
  dispose(): void;
}

export type VacpLiveSnapshots = { capabilities: VacpCapabilitiesSnapshot; state: VacpStateSnapshot };
