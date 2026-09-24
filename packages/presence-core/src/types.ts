import type { ProvenanceReplayController } from '@vacp/provenance-core';
import type {
  VacpExecution,
  VacpExecutionSource,
  VacpFocus,
  VacpObservation,
  VacpSourceId,
  VacpActor,
  VacpAgentActivitySource,
} from '@vacp/protocol';

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
  /**
   * Notify when geometry on this surface may have changed. Presence subscribes only while a pointer or
   * a recorded frame rests on the binding's source, and unsubscribes when none does. A subscription
   * that throws is reported through `onError` and tried again the next time the source is watched.
   */
  subscribe?: (invalidate: () => void) => () => void;
};

export type PresenceFreshness = 'unknown' | 'updating' | 'current' | 'error';
export type PresenceActivity = {
  actor: VacpActor;
  phase: 'thinking' | 'acting' | 'completed' | 'failed' | 'cancelled' | 'reviewing';
  /** Public narration supplied by the host. */
  summary?: string;
  /** A deliberate presentation of a recorded checkpoint, separate from live narration. */
  recordId?: string;
  /** Identity of the host progress session, independent of action execution. */
  activityId?: string;
  /** The analytical view the step works on, read from the live graph. */
  subject?: string;
  execution?: VacpExecution;
  target: PresenceTarget | null;
  freshness: PresenceFreshness;
};

/** A frame of a request's trail: the state it began from, one of its steps, or its conclusion. */
export type PresenceTrailFrame = 'start' | 'step' | 'conclusion';

export type PresenceNavigation = {
  /** The request being shown, in order. A request has at most one start and one conclusion. */
  frames: readonly PresenceTrailFrame[];
  /** The shown frame in `frames`, or -1 when the shown state lies outside this request. */
  index: number;
  canBack: boolean;
  canForward: boolean;
  reviewing: boolean;
  restoring: boolean;
  /** An agent's turn is open, or another actor's change is still on its way into the trail. Stepping waits. */
  working: boolean;
  /** Show another frame. The conclusion is the live state after the request. */
  go(index: number): void;
  back(): void;
  forward(): void;
  /** Leave review, or dismiss the retained step. Either hides the trail until the agent starts new work. */
  close(): void;
};
export type PresenceFrame = {
  activities: readonly PresenceActivity[];
  reason: 'activity' | 'layout';
  navigation?: PresenceNavigation;
};
export type PresenceRenderer = {
  render(frame: PresenceFrame): void;
  /** Optional visual arrival. Used only when a host explicitly enables pacing. */
  arrive?: (executionId: string, signal: AbortSignal) => Promise<void>;
  dispose?(): void;
};

export type PresenceSource = VacpExecutionSource &
  Partial<VacpAgentActivitySource> & {
    subscribeSnapshots(listener: (snapshots: { observation: VacpObservation }) => void): () => void;
  };

export type PresenceOptions = {
  renderer?: PresenceRenderer;
  /** One visibility policy for public progress, executions and recorded presentation. */
  includeActor?: (actor: VacpActor) => boolean;
  /** An independently owned replay controller. This viewer applies its actor policy. Presence never disposes it. */
  replay?: ProvenanceReplayController;
  maxActors?: number;
  /** How long terminal activity remains visible. Default: 1600 ms. */
  lingerMs?: number;
  /**
   * A new summary from an actor that has already acted, arriving between its steps, waits for the
   * next execution so the words start with the movement they describe. This bounds the wait.
   * Default: 2000 ms. 0 shows every summary as it arrives.
   */
  narrationHoldMs?: number;
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

/** Presentation policy only. Recording always retains every actor. */
export function isAgentActor(actor: VacpActor): boolean {
  return actor.kind === 'agent';
}
