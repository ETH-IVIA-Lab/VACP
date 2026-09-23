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
}
