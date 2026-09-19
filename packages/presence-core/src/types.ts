import type { VacpExecution, VacpExecutionSource, VacpFocus, VacpObservation, VacpSourceId } from '@vacp/protocol';

export type PresencePoint = { x: number; y: number };
export type PresenceGeometry =
  | { kind: 'point'; point: PresencePoint }
  | { kind: 'region'; x: number; y: number; width: number; height: number }
  | { kind: 'path'; points: readonly PresencePoint[] };

/** Coordinates belong to this named presentation surface, never to the protocol graph. */
export type PresenceTarget = {
  surface: string;
  geometry: PresenceGeometry;
  precision: 'exact' | 'region' | 'surface';
};

export type PresenceResolver = (
  focus: VacpFocus,
  options: { signal: AbortSignal },
) => PresenceTarget | null | Promise<PresenceTarget | null>;

export type PresenceBinding = {
  sourceId: VacpSourceId;
  /** The generation returned by the runtime's getProviderBinding(provider). */
  id: string;
  signal: AbortSignal;
  resolve: PresenceResolver;
  /** Notify only when active geometry may have changed. */
  subscribe?: (invalidate: () => void) => () => void;
};

export type PresenceFreshness = 'unknown' | 'updating' | 'current' | 'error';
export type PresenceActivity = {
  execution: VacpExecution;
  target: PresenceTarget | null;
  freshness: PresenceFreshness;
};

export type PresenceRenderer = {
  render(activities: readonly PresenceActivity[]): void;
  /** Optional visual arrival. Used only when a host explicitly enables pacing. */
  arrive?: (executionId: string, signal: AbortSignal) => Promise<void>;
  dispose?(): void;
};

export type PresenceSource = VacpExecutionSource & {
  subscribeSnapshots(listener: (snapshots: { observation: VacpObservation }) => void): () => void;
};

export type PresenceOptions = {
  renderer?: PresenceRenderer;
  /** A host may filter actors or operations without modifying execution. */
  include?: (execution: VacpExecution) => boolean;
  maxActors?: number;
  /** How long terminal activity remains visible. Default: 1600 ms. */
  lingerMs?: number;
  onError?: (error: unknown) => void;
};

export type PresencePacing = {
  /** Maximum wait for target resolution and cursor arrival. Default: 350 ms. */
  arrivalTimeoutMs?: number;
  /** Intentional pause at the target before execution. Default: 0. */
  beforeExecuteMs?: number;
  /** Hold the completed result before returning it to the caller. Default: 0. */
  afterExecuteMs?: number;
};

/** A passive viewer can report arrival without controlling execution. */
export type PresenceArrival = {
  readonly signal: AbortSignal;
  getSnapshot(): readonly PresenceActivity[];
  arrive(executionId: string, signal: AbortSignal): Promise<void>;
};
