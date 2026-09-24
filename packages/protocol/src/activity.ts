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
   * Speak for an agent whose turns have no lifecycle of their own, such as a model calling a progress
   * tool. The first sentence opens a turn, later sentences replace its words, and `done` closes it with
   * its sentence. A turn left quiet closes once the actor has no execution in flight. Aborting `signal`
   * cancels the open turn.
   */
  narrate(input: { actor: VacpActor; message: string; done?: boolean; signal?: AbortSignal }): void;
}
