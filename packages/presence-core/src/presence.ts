import { untilAborted } from './wait';
import {
  captureVacpValue,
  type VacpActor,
  type VacpExecution,
  type VacpGraph,
  type VacpObservation,
  type VacpAgentActivity,
} from '@vacp/protocol';
import { presenceSubject } from './subject';
import { createPresenceTargets, type PresenceFocus } from './targets';
import { createTargetTracker } from './tracker';
import { createPresencePresentation } from './presentation';
import { isAgentActor } from './types';
import type {
  PresenceActivity,
  PresenceBinding,
  PresenceFreshness,
  PresenceOptions,
  PresenceSource,
  PresenceTarget,
} from './types';

/** What one actor is doing. Everything published is derived from these fields by `view()`. */
type Entry = {
  actor: VacpActor;
  lifetime: AbortController;
  /** Executions at or below this sequence belong to an earlier turn of the same actor. */
  afterSequence: number;
  /** The host's progress record, never edited. */
  progress?: VacpAgentActivity;
  /** While the host's newest words wait for their step, the words still on screen. */
  hold?: { shown: string | undefined; timer: ReturnType<typeof setTimeout> };
  /** The shown execution: one isolated read for decisions, a fresh read for every publication. */
  step?: { value: VacpExecution; read: () => VacpExecution };
  /** Where the cursor rests: the focus of the latest focused step, kept across turns. */
  rest?: PresenceFocus;
  target?: () => PresenceTarget;
  freshness: PresenceFreshness;
  targets: ReturnType<typeof createTargetTracker>;
  retire?: ReturnType<typeof setTimeout>;
};

function terminal(execution: VacpExecution): boolean {
  return execution.phase === 'succeeded' || execution.phase === 'failed' || execution.phase === 'cancelled';
}

function phaseOf(step: VacpExecution | undefined, progress: VacpAgentActivity | undefined): PresenceActivity['phase'] {
  if (step?.phase === 'failed' || step?.phase === 'cancelled') return step.phase;
  if (step && !terminal(step)) return 'acting';
  return progress?.phase ?? 'completed';
}

/** One independent viewer. Coalescing changes presentation only, never execution. */
export function createAgentPresence(source: PresenceSource, options: PresenceOptions = {}) {
  const maxActors = options.maxActors ?? 4;
  const lingerMs = options.lingerMs ?? 1600;
  const narrationHoldMs = options.narrationHoldMs ?? 2000;
  if (!Number.isInteger(maxActors) || maxActors < 1) throw new Error('maxActors must be a positive integer');
  if (!Number.isFinite(lingerMs) || lingerMs < 0) throw new Error('lingerMs must be finite and non-negative');
  if (!Number.isFinite(narrationHoldMs) || narrationHoldMs < 0)
    throw new Error('narrationHoldMs must be finite and non-negative');
  source.signal.throwIfAborted();
  const lifetime = new AbortController();
  const active = new Map<string, Entry>();
  const latest = new Map<string, number>();
  let graph: VacpGraph | undefined;
  const includes = options.includeActor ?? isAgentActor;
  const listeners = new Set<(activities: readonly PresenceActivity[]) => void>();
  const safe = (run: () => void) => {
    try {
      run();
    } catch (error) {
      try {
        options.onError?.(error);
      } catch {
        /* Presentation diagnostics cannot affect execution. */
      }
    }
  };
  const report = (error: unknown) =>
    safe(() => {
      throw error;
    });
  const subjectRef = (entry: Entry) => {
    const intent = entry.step?.value.intent;
    return intent?.focus?.ref ?? intent?.affects?.[0] ?? entry.rest?.focus.ref;
  };
  const view = (entry: Entry): PresenceActivity =>
    Object.freeze({
      actor: Object.freeze({ ...(entry.progress?.actor ?? entry.step?.value.actor ?? entry.actor) }),
      phase: phaseOf(entry.step?.value, entry.progress),
      summary: entry.hold ? entry.hold.shown : entry.progress?.summary,
      activityId: entry.progress?.id,
      subject: graph ? presenceSubject(graph, subjectRef(entry)) : undefined,
      execution: entry.step?.read(),
      target: entry.target?.() ?? null,
      freshness: entry.freshness,
    });
  const snapshot = () => Object.freeze([...active.values()].map(view));
  const publish = (reason: 'activity' | 'layout' = 'activity', activityEvent = false) => {
    if (options.renderer || options.replay) safe(() => presentation.update(snapshot(), reason, activityEvent));
    if (!listeners.size) return;
    // Captured ordinary branches are shared; exotic host values are isolated on each delivery.
    for (const listener of listeners) safe(() => listener(snapshot()));
  };
  const create = (actor: VacpActor, carried: Partial<Pick<Entry, 'progress' | 'rest' | 'afterSequence'>>): Entry => {
    while (active.size >= maxActors) releaseActor(active.keys().next().value!);
    const entry: Entry = {
      actor,
      lifetime: new AbortController(),
      afterSequence: carried.afterSequence ?? -1,
      progress: carried.progress,
      rest: carried.rest,
      freshness: 'unknown',
      targets: createTargetTracker(
        targets.resolve,
        (target, reason) => {
          entry.target = target ? captureVacpValue(target) : undefined;
          publish(reason);
        },
        report,
      ),
    };
    active.set(actor.id, entry);
    return entry;
  };
  const releaseActor = (actorId: string) => {
    const entry = active.get(actorId);
    if (!entry) return;
    entry.lifetime.abort();
    clearTimeout(entry.retire);
    clearTimeout(entry.hold?.timer);
    active.delete(actorId);
  };
  /** The newest words show: the step they describe has begun, or the wait has run out. */
  const release = (entry: Entry) => {
    clearTimeout(entry.hold?.timer);
    entry.hold = undefined;
  };
  /** The shown step is over; the cursor keeps resting where it was. */
  const moveOn = (entry: Entry) => {
    entry.step = undefined;
    entry.freshness = 'unknown';
  };
  const locate = (entry: Entry, reason: 'activity' | 'layout' = 'activity') => {
    if (!entry.rest) {
      entry.targets.cancel();
      entry.target = undefined;
      return;
    }
    entry.targets.track(entry.rest, reason, AbortSignal.any([lifetime.signal, entry.lifetime.signal]));
  };
  const invalidateTargets = (bindingId?: string) => {
    if (lifetime.signal.aborted) return;
    for (const entry of active.values())
      if (!bindingId || entry.step?.value.bindingId === bindingId || entry.rest?.bindingId === bindingId)
        locate(entry, 'layout');
    safe(() => presentation.invalidate());
  };
  const targets = createPresenceTargets(lifetime.signal, invalidateTargets, report);
  const presentation = createPresencePresentation(options, targets.resolve, report);
  const retire = (actorId: string, entry: Entry) => {
    clearTimeout(entry.retire);
    entry.retire = setTimeout(() => {
      if (active.get(actorId) === entry) {
        releaseActor(actorId);
        publish();
      }
    }, lingerMs);
  };
  const onActivity = (progress: VacpAgentActivity) => {
    if (!includes(progress.actor)) return;
    let entry = active.get(progress.actor.id);
    if (!entry) {
      if (progress.phase !== 'thinking') return;
      entry = create(progress.actor, {});
    }
    if (entry.progress?.id !== progress.id) {
      // A new turn: earlier executions of this actor no longer belong to it.
      entry.afterSequence = latest.get(progress.actor.id) ?? -1;
      moveOn(entry);
    } else if (
      progress.phase === 'thinking' &&
      (entry.step?.value.phase === 'failed' || entry.step?.value.phase === 'cancelled')
    )
      moveOn(entry);
    const shown = entry.hold ? entry.hold.shown : entry.progress?.summary;
    // The cursor rests on a finished step, or on the last focused step of an earlier turn.
    const resting = entry.step ? terminal(entry.step.value) : entry.rest !== undefined;
    entry.progress = { ...progress, actor: { ...progress.actor } };
    clearTimeout(entry.retire);
    release(entry);
    if (
      narrationHoldMs > 0 &&
      resting &&
      progress.phase === 'thinking' &&
      progress.summary !== undefined &&
      progress.summary !== shown
    ) {
      // Words about the next step wait for it while the cursor still rests on the last one.
      const actorId = progress.actor.id;
      entry.hold = {
        shown,
        timer: setTimeout(() => {
          if (active.get(actorId) !== entry) return;
          entry.hold = undefined;
          publish('activity', true);
        }, narrationHoldMs),
      };
    }
    if (progress.phase !== 'thinking') retire(progress.actor.id, entry);
    publish('activity', true);
  };
  const onExecution = (execution: VacpExecution) => {
    if (!includes(execution.actor)) return;
    const actorId = execution.actor.id;
    if (execution.sequence <= (active.get(actorId)?.afterSequence ?? -1)) return;
    if (execution.sequence < (latest.get(actorId) ?? -1)) return;
    latest.delete(actorId);
    latest.set(actorId, execution.sequence);
    while (latest.size > maxActors * 4) latest.delete(latest.keys().next().value!);
    // Accepted requests have no validated intention yet. Rejections still get a textual outcome.
    if (execution.phase === 'accepted') return;
    let entry = active.get(actorId);
    // A first sighting in any phase starts a new shown step, releasing waits on the old one.
    if (entry && entry.step?.value.id !== execution.id) {
      const carried = { progress: entry.progress, rest: entry.rest, afterSequence: entry.afterSequence };
      releaseActor(actorId);
      entry = create(execution.actor, carried);
    }
    entry ??= create(execution.actor, {});
    const read = captureVacpValue(execution);
    const value = read();
    entry.step = { value, read };
    if (value.intent?.focus && value.sourceId)
      entry.rest = { focus: value.intent.focus, sourceId: value.sourceId, bindingId: value.bindingId };
    release(entry);
    if (!terminal(value)) clearTimeout(entry.retire);
    if (value.phase === 'prepared' || value.phase === 'running') locate(entry);
    if (value.phase === 'cancelled') {
      entry.lifetime.abort();
      entry.target = undefined;
    }
    if (terminal(value) && entry.progress?.phase !== 'thinking') retire(actorId, entry);
    publish('activity', true);
  };
  const freshnessOf = (entry: Entry, observation: VacpObservation): PresenceFreshness => {
    if (entry.step?.value.phase !== 'succeeded') return entry.freshness;
    const statuses = (entry.step.value.intent?.affects ?? []).map((ref) => observation.freshness?.[ref]?.status);
    return statuses.includes('error')
      ? 'error'
      : statuses.some((status) => status === 'stale' || status === 'running')
        ? 'updating'
        : statuses.length > 0 && statuses.every((status) => status === 'current')
          ? 'current'
          : 'unknown';
  };
  const onObservation = (observation: VacpObservation) => {
    const previous = graph;
    graph = observation.graph;
    if (!active.size) return;
    let changed = false;
    for (const entry of active.values()) {
      const ref = subjectRef(entry);
      changed ||= (previous && presenceSubject(previous, ref)) !== presenceSubject(graph, ref);
      // Canvas and other surfaces can change geometry without a DOM layout event.
      if (entry.step?.value.phase !== 'failed' && entry.step?.value.phase !== 'cancelled') {
        const had = entry.target !== undefined;
        locate(entry);
        changed ||= had !== (entry.target !== undefined);
      }
      const freshness = freshnessOf(entry, observation);
      changed ||= freshness !== entry.freshness;
      entry.freshness = freshness;
    }
    // Target lookups publish their own result; an unchanged observation has nothing to present.
    if (changed) publish();
  };
  const subscriptions: Array<() => void> = [];
  try {
    subscriptions.push(source.subscribeExecutions(onExecution));
    if (source.subscribeAgentActivities) subscriptions.push(source.subscribeAgentActivities(onActivity));
    for (const activity of source.getAgentActivities?.() ?? []) onActivity(activity);
    for (const execution of source.getActiveExecutions()) onExecution(execution);
    subscriptions.push(source.subscribeSnapshots(({ observation }) => onObservation(observation)));
  } catch (error) {
    lifetime.abort();
    presentation.dispose();
    targets.dispose();
    for (const release of subscriptions.reverse()) safe(release);
    for (const actorId of active.keys()) releaseActor(actorId);
    safe(() => options.renderer?.dispose?.());
    throw error;
  }

  const dispose = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    for (const release of subscriptions.reverse()) safe(release);
    targets.dispose();
    presentation.dispose();
    for (const actorId of active.keys()) releaseActor(actorId);
    publish();
    listeners.clear();
    latest.clear();
    safe(() => options.renderer?.dispose?.());
    source.signal.removeEventListener('abort', dispose);
  };
  source.signal.addEventListener('abort', dispose, { once: true });
  return {
    signal: lifetime.signal,
    getSnapshot: snapshot,
    invalidateTargets,
    async arrive(executionId: string, signal: AbortSignal) {
      const entry = [...active.values()].find((value) => value.step?.value.id === executionId);
      if (!entry) return;
      const waiting = AbortSignal.any([signal, lifetime.signal, entry.lifetime.signal]);
      while (!waiting.aborted && active.get(entry.actor.id) === entry) {
        const pending = entry.targets.pending;
        if (pending) await untilAborted(pending, waiting);
        if (waiting.aborted || active.get(entry.actor.id) !== entry) return;
        if (pending !== entry.targets.pending) continue;
        if (entry.target && options.renderer?.arrive) {
          const lookup = entry.targets.signal;
          const arrival = lookup ? AbortSignal.any([waiting, lookup]) : waiting;
          await untilAborted(options.renderer.arrive(executionId, arrival), arrival);
          if (pending !== entry.targets.pending) continue;
        }
        return;
      }
    },
    subscribe(listener: (activities: readonly PresenceActivity[]) => void) {
      lifetime.signal.throwIfAborted();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach(binding: PresenceBinding) {
      return targets.attach(binding, () => {
        for (const [actorId, entry] of active)
          if (entry.step?.value.bindingId === binding.id || entry.rest?.bindingId === binding.id) {
            if (entry.progress?.phase === 'thinking') {
              // The surface is gone; the actor's words stay while it has nowhere to rest.
              moveOn(entry);
              entry.rest = undefined;
              locate(entry);
            } else releaseActor(actorId);
          }
        publish();
      });
    },
    dispose,
  };
}
