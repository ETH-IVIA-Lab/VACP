import type { VacpActionResult, VacpOperationKind, VacpRef, VacpSourceId } from './schema';

/** An action failure with transport-neutral, serializable details. */
export class VacpActionError<Details = unknown> extends Error {
  constructor(
    message: string,
    readonly details: Details,
  ) {
    super(message);
    this.name = 'VacpActionError';
  }
}

/** Identity supplied by the calling host, separate from action parameters. */
export type VacpActor = { id: string; label?: string; kind: 'agent' | 'human' | 'system' };

/** The actor every agent transport attributes calls to when the host names none. `test/fixtures/agent-tools.json` pins it for the Python server. */
export const vacpAgentActor: VacpActor = Object.freeze({ id: 'agent', kind: 'agent', label: 'Agent' });

/** The actor restoration and replay attribute to when the host names none. */
export const vacpHumanActor: VacpActor = Object.freeze({ id: 'human', kind: 'human', label: 'You' });

/** In-process execution controls; these are not part of the serialized call. */
export type VacpActionExecutionOptions = {
  signal?: AbortSignal;
  /** Host attribution, never inferred from model-supplied action parameters. */
  actor?: VacpActor;
  /** Host-owned provenance for restoring a recorded state, not a new analytical step. */
  restoration?: { id: string; entryId?: string };
  /**
   * The step's own public sentence for the person watching. The execution carries it from acceptance,
   * so the live step and its replay show the same words. At most `VACP_NARRATION_MAX_LENGTH` code points.
   */
  narration?: string;
};

/** Optional interaction meaning. Renderers choose their own assets and feedback. */
export type VacpInteraction = {
  kind: 'point' | 'activate' | 'brush' | 'drag' | 'pan' | 'zoom' | 'edit' | 'resize' | (string & {});
  axis?: 'x' | 'y' | 'xy';
  direction?: 'in' | 'out';
};

/** Semantic focus. Detail is provider-owned, serializable domain data, never screen coordinates. */
export type VacpFocus<Detail = unknown> = { ref: VacpRef; detail?: Detail; interaction?: VacpInteraction };

export type VacpActionIntent<Detail = unknown> = {
  focus?: VacpFocus<Detail>;
  affects: VacpRef[];
};

/** A validated, single-use operation. Preparation must not mutate the analytical source. */
export type VacpPreparedAction = {
  intent: VacpActionIntent;
  execute(options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
};

/** Execution completion is independent of the freshness of affected outputs. */
export type VacpExecution = {
  id: string;
  /** Monotonic within the emitting runtime, independent of caller call IDs. */
  sequence: number;
  callId: string;
  name: string;
  title?: string;
  operationKind?: VacpOperationKind;
  actor: VacpActor;
  /** The actor's public activity, its turn, when the execution began. Steps of one request share it. */
  activityId?: string;
  /**
   * The step's own sentence, fixed when the step is accepted: the narration it was sent with, else the
   * actor's live words that no earlier step of the turn carried.
   */
  narration?: string;
  sourceId?: VacpSourceId;
  bindingId?: string;
  restoration?: VacpActionExecutionOptions['restoration'];
  phase: 'accepted' | 'prepared' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  at: string;
  intent?: VacpActionIntent;
  /** Failure summary only. Parameters and results are not copied into the activity stream. */
  message?: string;
};

/** Whether the execution reached its last phase: succeeded, failed, or cancelled. */
export function isVacpExecutionSettled(execution: Pick<VacpExecution, 'phase'>): boolean {
  return execution.phase === 'succeeded' || execution.phase === 'failed' || execution.phase === 'cancelled';
}

export type VacpExecutionGate = (execution: VacpExecution, signal: AbortSignal) => void | Promise<void>;

export interface VacpExecutionSource {
  readonly signal: AbortSignal;
  /** Active execution snapshot, so late subscribers do not miss in-flight work. */
  getActiveExecutions(): readonly VacpExecution[];
  subscribeExecutions(listener: (execution: VacpExecution) => void): () => void;
}

/** Optional host authority, supplied separately from passive execution observation. */
export interface VacpExecutionControl {
  readonly signal: AbortSignal;
  /** Bounded presentation waits. After-execution waits never change the known action result. */
  addExecutionGate(gate: VacpExecutionGate, options: { timeoutMs: number; stage?: 'before' | 'after' }): () => void;
}
