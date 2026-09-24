import {
  nowIso,
  parseVacpNarration,
  type VacpAgentActivity,
  type VacpAgentActivityControl,
  type VacpAgentActivityHandle,
  type VacpActor,
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
  // Long enough for a reasoning model's pause between tool calls; it only ends a forgotten turn.
  const idleMs = options.idleMs ?? 60_000;
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

  /**
   * Turns opened by `narrate` or by an agent's first step, closed by `done`, by a quiet spell with no
   * work in flight, or by abort. Words and steps both count as activity, so a request never splits
   * while its agent keeps working.
   */
  type Narrated = { handle: VacpAgentActivityHandle; id: string; idle?: ReturnType<typeof setTimeout> };
  const narrated = new Map<string, Narrated>();
  const release = (actorId: string) => {
    clearTimeout(narrated.get(actorId)?.idle);
    narrated.delete(actorId);
  };
  const live = (actorId: string) => {
    const turn = narrated.get(actorId);
    return turn && active.get(actorId)?.activity.id === turn.id ? turn : undefined;
  };
  const keepOpen = (actorId: string, turn: Narrated) => {
    const quiet = () => {
      if (narrated.get(actorId) !== turn) return;
      // Slow queries, pacing, and model thinking between steps belong to the same turn.
      if (options.busy(actorId)) turn.idle = setTimeout(quiet, idleMs);
      else {
        release(actorId);
        turn.handle.end();
      }
    };
    clearTimeout(turn.idle);
    turn.idle = setTimeout(quiet, idleMs);
  };
  const open = (actor: VacpActor, text: string | undefined, turnSignal?: AbortSignal) => {
    release(actor.id);
    const handle = beginAgentActivity({ actor, summary: text, signal: turnSignal });
    const turn = { handle, id: active.get(actor.id)!.activity.id };
    narrated.set(actor.id, turn);
    return turn;
  };
  const narrate: VacpAgentActivityControl['narrate'] = ({ actor, message, done, signal: turnSignal }) => {
    signal.throwIfAborted();
    const text = parseVacpNarration(message, 'message');
    const turn = live(actor.id);
    if (done) {
      release(actor.id);
      (turn?.handle ?? beginAgentActivity({ actor, signal: turnSignal })).end({ summary: text });
      return;
    }
    if (turn) turn.handle.update(text);
    keepOpen(actor.id, turn ?? open(actor, text, turnSignal));
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
     * words once. An agent's step with no turn open opens one, so every request has a turn from its
     * first step to its conclusion. A step that carries the live words owns them, so a following step
     * without new words carries none instead of repeating its predecessor. The first step fixes the
     * turn's opening.
     */
    beginStep(actor: VacpActor, narration: string | undefined): { activityId?: string; narration?: string } {
      if (!active.has(actor.id) && actor.kind === 'agent') open(actor, undefined);
      const entry = active.get(actor.id);
      if (!entry) return { narration };
      const turn = live(actor.id);
      if (turn) keepOpen(actor.id, turn);
      const words = entry.activity.summary;
      const carried = narration ?? (words !== entry.claimed ? words : undefined);
      if (carried !== undefined && carried === words) entry.claimed = words;
      if (!entry.stepped) {
        entry.stepped = true;
        entry.opening = words !== carried ? words : undefined;
      }
      return { activityId: entry.activity.id, narration: carried };
    },
    /** A step ended: the actor's quiet spell starts again from here. */
    endStep(actorId: string) {
      const turn = live(actorId);
      if (turn) keepOpen(actorId, turn);
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
