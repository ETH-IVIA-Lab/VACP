import { nowIso, type VacpAgentActivity, type VacpAgentActivityControl } from '@vacp/protocol';
import { makeEntryId, notify } from './helpers';

/** Ephemeral host sessions. New work for an actor supersedes its previous handle. */
export function createAgentActivityChannel(signal: AbortSignal) {
  const active = new Map<string, { activity: VacpAgentActivity; cancel(): void }>();
  const listeners = new Set<(activity: VacpAgentActivity) => void>();
  const publish = (activity: VacpAgentActivity) => {
    notify(listeners, activity);
  };
  const summary = (value: string | undefined) => {
    if (value !== undefined && (typeof value !== 'string' || value.length > 500))
      throw new Error('Agent activity summaries must be strings of at most 500 characters');
    return value?.trim() || undefined;
  };
  const beginAgentActivity: VacpAgentActivityControl['beginAgentActivity'] = (options) => {
    signal.throwIfAborted();
    options.signal?.throwIfAborted();
    if (!options.actor.id.trim()) throw new Error('Agent activity requires an actor ID');
    const activity: VacpAgentActivity = {
      id: makeEntryId(),
      actor: { ...options.actor },
      phase: 'thinking',
      summary: summary(options.summary),
      at: nowIso(),
    };
    active.get(activity.actor.id)?.cancel();
    // Bound retained sessions even when a host forgets to finish work.
    if (active.size >= 32) active.values().next().value?.cancel();
    const end = (outcome: 'completed' | 'failed' | 'cancelled', text?: string) => {
      if (active.get(activity.actor.id)?.activity.id !== activity.id) return;
      // Ending without new words keeps the last public summary.
      const nextSummary = text === undefined ? activity.summary : summary(text);
      options.signal?.removeEventListener('abort', cancel);
      active.delete(activity.actor.id);
      publish({ ...activity, phase: outcome, summary: nextSummary, at: nowIso() });
    };
    const cancel = () => end('cancelled');
    active.set(activity.actor.id, { activity, cancel });
    options.signal?.addEventListener('abort', cancel, { once: true });
    publish(activity);
    return {
      update(text) {
        if (active.get(activity.actor.id)?.activity.id !== activity.id) return;
        activity.summary = summary(text);
        activity.at = nowIso();
        publish(activity);
      },
      end: (options = {}) => end(options.outcome ?? 'completed', options.summary),
    };
  };
  const clear = () => {
    for (const entry of [...active.values()]) entry.cancel();
  };
  signal.addEventListener(
    'abort',
    () => {
      clear();
      listeners.clear();
    },
    { once: true },
  );
  return {
    beginAgentActivity,
    getAgentActivities: () => structuredClone([...active.values()].map((entry) => entry.activity)),
    /** The live public summary of one actor, for records written while it speaks. */
    summaryOf: (actorId: string) => active.get(actorId)?.activity.summary,
    subscribeAgentActivities(listener: (activity: VacpAgentActivity) => void) {
      signal.throwIfAborted();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear,
  };
}
