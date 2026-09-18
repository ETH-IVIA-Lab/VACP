import type {
  VacpCapabilitiesSnapshot,
  VacpObservation,
  VacpProvider,
  VacpRuntimeBridge,
  VacpStateSnapshot,
} from '@vacp/protocol';

export type VacpRuntimeUpdate = {
  providers: readonly VacpProvider[];
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
  readonly providerIds: readonly string[];
  attachProvider(provider: VacpProvider): () => void;
  removeProvider(sourceId: string): void;
  update(next: VacpRuntimeUpdate): void;
  /** Live graph changes, independent of history and inspection overrides. */
  subscribeCapabilities(listener: (snapshot: VacpCapabilitiesSnapshot) => void): () => void;
  /** Live snapshots for output adapters, independent of the history stream. */
  subscribeSnapshots(listener: (snapshots: VacpLiveSnapshots) => void): () => void;
  dispose(): void;
}

export type VacpLiveSnapshots = {
  observation: VacpObservation;
  capabilities: VacpCapabilitiesSnapshot;
  state: VacpStateSnapshot;
};
