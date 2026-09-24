import {
  nowIso,
  parseVacpNarration,
  type VacpAgentActivity,
  type VacpAgentActivityControl,
  type VacpAgentActivityHandle,
} from '@vacp/protocol';
import { makeEntryId, notify } from './helpers';

type Outcome = 'completed' | 'failed' | 'cancelled';
/** A finished turn with the words that opened and closed it. Words a step carried are neither. */
type Ended = (activity: VacpAgentActivity & { phase: Outcome }, words: { opening?: string; closing?: string }) => void;

/**
 * Ephemeral host sessions, one turn per actor. New work for an actor supersedes its previous turn.
 * `ended` records each finished turn before its completion is published, so viewers find the
 * request's conclusion as soon as the live entry goes idle.
 */
export function createAgentActivityChannel(
  signal: AbortSignal,
  options: { ended: Ended; busy: (actorId: string) => boolean; idleMs?: number },
) {
  const idleMs = options.idleMs ?? 15_000;
  const active = new Map<
    string,
    {
      activity: VacpAgentActivity;
      cancel(): void;
      /** The live words a step carried, so no later step or closing repeats them. */
      claimed?: string;
      /** The words the turn opened with, fixed when its first step begins. */
      opening?: string;
      stepped: boolean;
    }
  >();
  const listeners = new Set<(activity: VacpAgentActivity) => void>();
  const summary = (value: string | undefined) => {
    if (value !== undefined && (typeof value !== 'string' || value.length > 500))
      throw new Error('Agent activity summaries must be strings of at most 500 characters');
    return value?.trim() || undefined;
  };
  const beginAgentActivity: VacpAgentActivityControl['beginAgentActivity'] = (input) => {
    signal.throwIfAborted();
    input.signal?.throwIfAborted();
    if (!input.actor.id.trim()) throw new Error('Agent activity requires an actor ID');
    const activity: VacpAgentActivity = {
      id: makeEntryId(),
      actor: { ...input.actor },
      phase: 'thinking',
      summary: summary(input.summary),
      at: nowIso(),
    };
    active.get(activity.actor.id)?.cancel();
    // Bound retained sessions even when a host forgets to finish work.
    if (active.size >= 32) active.values().next().value?.cancel();
    const current = () => active.get(activity.actor.id)?.activity.id === activity.id;
    const end = (outcome: Outcome, text?: string) => {
      const entry = active.get(activity.actor.id);
      if (!entry || entry.activity.id !== activity.id) return;
      // Ending without new words keeps the last public summary.
      const closing = text === undefined ? activity.summary : summary(text);
      input.signal?.removeEventListener('abort', cancel);
      active.delete(activity.actor.id);
      const finished = { ...activity, phase: outcome, summary: closing, at: nowIso() };
      options.ended(finished, {
        opening: entry.opening,
        closing: closing !== entry.claimed && closing !== entry.opening ? closing : undefined,
      });
      notify(listeners, finished);
    };
    const cancel = () => end('cancelled');
    active.set(activity.actor.id, { activity, cancel, stepped: false });
    input.signal?.addEventListener('abort', cancel, { once: true });
    notify(listeners, activity);
    return {
      update(text) {
        if (!current()) return;
        activity.summary = summary(text);
        activity.at = nowIso();
        notify(listeners, activity);
      },
      end: (settings = {}) => end(settings.outcome ?? 'completed', settings.summary),
    };
  };

  /** Turns opened by `narrate`, closed by `done`, by a quiet spell with no work in flight, or by abort. */
  const narrated = new Map<
    string,
    { handle: VacpAgentActivityHandle; id: string; idle?: ReturnType<typeof setTimeout> }
  >();
  const release = (actorId: string) => {
    clearTimeout(narrated.get(actorId)?.idle);
    narrated.delete(actorId);
  };
  const narrate: VacpAgentActivityControl['narrate'] = ({ actor, message, done, signal: turnSignal }) => {
    signal.throwIfAborted();
    const text = parseVacpNarration(message, 'message');
    const open = narrated.get(actor.id);
    const live = open && active.get(actor.id)?.activity.id === open.id ? open : undefined;
    if (done) {
      release(actor.id);
      (live?.handle ?? beginAgentActivity({ actor, signal: turnSignal })).end({ summary: text });
      return;
    }
    let turn = live;
    if (turn) turn.handle.update(text);
    else {
      release(actor.id);
      const handle = beginAgentActivity({ actor, summary: text, signal: turnSignal });
      turn = { handle, id: active.get(actor.id)!.activity.id };
      narrated.set(actor.id, turn);
    }
    const quiet = () => {
      if (narrated.get(actor.id) !== turn) return;
      // Slow queries, pacing, and model thinking between steps belong to the same turn.
      if (options.busy(actor.id)) turn.idle = setTimeout(quiet, idleMs);
      else {
        release(actor.id);
        turn.handle.end();
      }
    };
    clearTimeout(turn.idle);
    turn.idle = setTimeout(quiet, idleMs);
  };

  const clear = () => {
    for (const actorId of [...narrated.keys()]) release(actorId);
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
    narrate,
    getAgentActivities: () => structuredClone([...active.values()].map((entry) => entry.activity)),
    /**
     * A step begins: it belongs to the actor's turn and carries `narration`, else the actor's live
     * words once. A step that carries the live words owns them, so a following step without new words
     * carries none instead of repeating its predecessor. The first step fixes the turn's opening.
     */
    beginStep(actorId: string, narration: string | undefined): { activityId?: string; narration?: string } {
      const entry = active.get(actorId);
      if (!entry) return { narration };
      const words = entry.activity.summary;
      const carried = narration ?? (words !== entry.claimed ? words : undefined);
      if (carried !== undefined && carried === words) entry.claimed = words;
      if (!entry.stepped) {
        entry.stepped = true;
        entry.opening = words !== carried ? words : undefined;
      }
      return { activityId: entry.activity.id, narration: carried };
    },
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
