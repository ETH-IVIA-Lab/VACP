import type {
  VacpCapabilitiesSnapshot,
  VacpObservation,
  VacpProvider,
  VacpPageBridge,
  VacpStateSnapshot,
  VacpExecutionControl,
  VacpAgentActivitySource,
} from '@ethivia/vacp-protocol';

export interface VacpRuntime extends VacpPageBridge, VacpExecutionControl, VacpAgentActivitySource {
  /** Aborted when this runtime is disposed. */
  readonly signal: AbortSignal;
  readonly providerIds: readonly string[];
  /** Atomically attach sources; cleanup releases only sources still owned by this attachment. */
  attachProviders(providers: readonly VacpProvider[]): () => void;
  /** A local attachment lease. Its identity changes whenever this provider is replaced. */
  getProviderBinding(provider: VacpProvider): { id: string; signal: AbortSignal };
  /** Replace every source. A changed session key starts a new history. */
  update(next: { providers: readonly VacpProvider[]; sessionKey?: string }): void;
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
