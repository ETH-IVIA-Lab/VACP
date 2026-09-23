import type {
  VacpCapabilitiesSnapshot,
  VacpObservation,
  VacpProvider,
  VacpRuntimeBridge,
  VacpStateSnapshot,
  VacpExecutionSource,
  VacpExecutionControl,
  VacpAgentActivitySource,
  VacpAgentActivityControl,
} from '@vacp/protocol';

export type VacpRuntimeUpdate = {
  providers: readonly VacpProvider[];
  /**
   * Optional session identifier for the current attached visualization/view.
   * If this changes, tooling may treat it as a new runtime session.
   */
  sessionKey?: string;
};

export interface VacpRuntime
  extends
    Required<Omit<VacpRuntimeBridge, 'runtimeId' | 'sessionKey'>>,
    VacpExecutionSource,
    VacpExecutionControl,
    VacpAgentActivitySource,
    VacpAgentActivityControl {
  /** Aborted when this runtime is disposed. */
  readonly signal: AbortSignal;
  readonly runtimeId: string;
  readonly sessionKey: string | undefined;
  readonly providerIds: readonly string[];
  /** Atomically attach sources; cleanup releases only sources still owned by this attachment. */
  attachProviders(providers: readonly VacpProvider[]): () => void;
  removeProvider(sourceId: string): void;
  /** A local attachment lease. Its identity changes whenever this provider is replaced. */
  getProviderBinding(provider: VacpProvider): { id: string; signal: AbortSignal };
  update(next: VacpRuntimeUpdate): void;
  /** Live graph changes, independent of history. */
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
