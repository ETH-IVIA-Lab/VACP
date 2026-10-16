import type { VacpActor } from './execution';

/** Host-authored public progress, separate from model reasoning and analytical state. */
export type VacpAgentActivity = {
  id: string;
  actor: VacpActor;
  phase: 'thinking' | 'completed' | 'failed' | 'cancelled';
  summary?: string;
  at: string;
};

export interface VacpAgentActivitySource {
  getAgentActivities(): readonly VacpAgentActivity[];
  subscribeAgentActivities(listener: (activity: VacpAgentActivity) => void): () => void;
}

export type VacpAgentActivityHandle = {
  /** Replace the short, user-facing progress summary. Stale handles have no effect. */
  update(summary: string): void;
  /** Finish the turn. The last summary stays unless a new one is given. */
  end(options?: { outcome?: 'completed' | 'failed' | 'cancelled'; summary?: string }): void;
};

/** Trusted hosts publish progress; passive viewers only receive it. */
export interface VacpAgentActivityControl {
  beginAgentActivity(options: { actor: VacpActor; summary?: string; signal?: AbortSignal }): VacpAgentActivityHandle;
  /**
   * Speak for an agent, such as a model calling a progress tool. A sentence joins the actor's open
   * turn, whether a host, a step, or an earlier sentence opened it, and otherwise opens one. Later
   * sentences replace its words, and `done` closes it with its sentence. A turn opened by a sentence or
   * a step closes once quiet with no execution in flight. Aborting `signal` cancels a turn this call
   * opens.
   */
  narrate(input: { actor: VacpActor; message: string; done?: boolean; signal?: AbortSignal }): void;
}
