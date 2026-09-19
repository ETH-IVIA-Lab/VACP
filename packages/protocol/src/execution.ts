import type { VacpActionExecutionOptions, VacpActionResult, VacpRef, VacpSourceId } from './schema.js';

/** Identity supplied by the calling host, separate from action parameters. */
export type VacpActor = { id: string; label?: string; kind: 'agent' | 'human' | 'system' };

/** Semantic focus. Detail is provider-owned, serializable domain data, never screen coordinates. */
export type VacpFocus<Detail = unknown> = { ref: VacpRef; detail?: Detail };

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
  actor: VacpActor;
  sourceId?: VacpSourceId;
  bindingId?: string;
  phase: 'accepted' | 'prepared' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  at: string;
  intent?: VacpActionIntent;
  /** Failure summary only. Parameters and results are not copied into the activity stream. */
  message?: string;
};

export type VacpExecutionGate = (execution: VacpExecution, signal: AbortSignal) => void | Promise<void>;

export interface VacpExecutionSource {
  readonly signal: AbortSignal;
  subscribeExecutions(listener: (execution: VacpExecution) => void): () => void;
}

/** Optional host authority, supplied separately from passive execution observation. */
export interface VacpExecutionControl {
  readonly signal: AbortSignal;
  /** Bounded presentation waits. After-execution waits never change the known action result. */
  addExecutionGate(gate: VacpExecutionGate, options: { timeoutMs: number; stage?: 'before' | 'after' }): () => void;
}
