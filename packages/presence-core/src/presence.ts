import { untilAborted } from './wait';
import {
  isVacpExecutionSettled,
  captureVacpValue,
  type VacpActor,
  type VacpProvider,
  type VacpExecution,
  type VacpGraph,
  type VacpObservation,
  type VacpAgentActivity,
} from '@ethivia/vacp-protocol';
import { stepSubject } from './subject';
import { createPresenceTargets, stepPlaces, type PresenceFocus } from './targets';
import { createTargetTracker } from './tracker';
import { createPresencePresentation } from './presentation';
import { isAgentActor, samePresenceActivity } from './types';
import type {
  PresenceActivity,
  PresencePresentation,
  PresenceBinding,
  PresenceFreshness,
  PresenceOptions,
  PresenceSource,
  PresenceTarget,
} from './types';

/**
 * The execution an actor shows. Its lifetime ends target lookups and arrival waits made for it.
 * `shared` is false when the execution holds exotic host values, which each delivery copies.
 */
type Step = { value: VacpExecution; read: () => VacpExecution; lifetime: AbortController; shared: boolean };

/** What one actor is doing. Everything published is derived from these fields by `view()`. */
type Entry = {
  actor: VacpActor;
  lifetime: AbortController;
  /** Executions at or below this sequence belong to an earlier turn of the same actor. */
  afterSequence: number;
  /** The host's progress record, never edited. */
  progress?: VacpAgentActivity;
  /** The host's words when the shown step began. Newer words replace the step's own sentence. */
  heard?: string;
  /** While the host's newest words wait for their step, the words still on screen. */
  hold?: { shown: string | undefined; timer: ReturnType<typeof setTimeout> };
  step?: Step;
  /**
   * Where the cursor rests, kept across turns: the first of these places a surface can show. The latest
   * step that points anywhere sets it to its focus, or to the nodes it changes and then `placed`.
   */
  rest?: readonly PresenceFocus[];
  /** The step `rest` was derived from. */
  restFor?: string;
  /** The place the cursor last reached. */
  placed?: PresenceFocus;
  target?: () => PresenceTarget;
  freshness: PresenceFreshness;
  targets: ReturnType<typeof createTargetTracker>;
  retire?: ReturnType<typeof setTimeout>;
  /** The last published projection, reused while nothing it shows has changed. */
  published?: PresenceActivity;
};

function phaseOf(step: VacpExecution | undefined, progress: VacpAgentActivity | undefined): PresenceActivity['phase'] {
  if (step?.phase === 'failed' || step?.phase === 'cancelled') return step.phase;
  if (step && !isVacpExecutionSettled(step)) return 'acting';
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
  /** A step shows its own sentence until the host says something newer; waiting words hold the old ones. */
  const displayed = (entry: Entry) =>
    entry.hold
      ? entry.hold.shown
      : entry.step && entry.progress?.summary === entry.heard
        ? entry.step.value.narration
        : entry.progress?.summary;
  const view = (entry: Entry): PresenceActivity => {
    const actor = entry.progress?.actor ?? entry.step?.value.actor ?? entry.actor;
    const next = {
      phase: phaseOf(entry.step?.value, entry.progress),
      summary: displayed(entry),
      activityId: entry.progress?.id,
      subject: graph ? stepSubject(graph, entry.step?.value, (entry.placed ?? entry.rest?.[0])?.focus.ref) : undefined,
      execution: entry.step?.read(),
      target: entry.target?.() ?? null,
      freshness: entry.freshness,
    };
    const previous = entry.published;
    if (samePresenceActivity(previous, { actor, ...next })) return previous!;
    return (entry.published = Object.freeze({ actor: Object.freeze({ ...actor }), ...next }));
  };
  let snapshotted: readonly PresenceActivity[] = Object.freeze([]);
  /** Unchanged entries keep their projections, and an unchanged snapshot keeps its identity. */
  const snapshot = () => {
    const next = [...active.values()].map(view);
    if (next.length !== snapshotted.length || next.some((activity, index) => activity !== snapshotted[index]))
      snapshotted = Object.freeze(next);
    return snapshotted;
  };
  let heard: readonly PresenceActivity[] | undefined;
  const publish = (reason: 'activity' | 'layout' = 'activity', activityEvent = false) => {
    const activities = snapshot();
    if (options.renderer || options.replay) safe(() => presentation.update(activities, reason, activityEvent));
    if (activities === heard) return;
    heard = activities;
    // Captured ordinary values are shared; exotic host values are copied for each listener.
    const isolated = [...active.values()].some((entry) => entry.step && !entry.step.shared);
    for (const listener of listeners)
      safe(() =>
        listener(
          isolated
            ? Object.freeze(
                [...active.values()].map((entry) => Object.freeze({ ...view(entry), execution: entry.step?.read() })),
              )
            : activities,
        ),
      );
  };
  const create = (actor: VacpActor): Entry => {
    while (active.size >= maxActors) releaseActor(active.keys().next().value!);
    const entry: Entry = {
      actor,
      lifetime: new AbortController(),
      afterSequence: -1,
      freshness: 'unknown',
      targets: createTargetTracker(
        targets,
        (target, reason, place) => {
          entry.target = target ? captureVacpValue(target) : undefined;
          if (place) entry.placed = place;
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
    entry.step?.lifetime.abort();
    entry.targets.stop();
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
    entry.step?.lifetime.abort();
    entry.step = undefined;
    entry.freshness = 'unknown';
  };
  const locate = (entry: Entry, reason: 'activity' | 'layout' = 'activity') => {
    if (!entry.rest) {
      entry.targets.stop();
      entry.target = undefined;
      return;
    }
    const signals = [lifetime.signal, entry.lifetime.signal];
    if (entry.step) signals.push(entry.step.lifetime.signal);
    entry.targets.track(entry.rest, reason, AbortSignal.any(signals));
  };
  /** Surfaces moved: pointers and the recorded frame on `binding`, or on every binding, look again. */
  const invalidateTargets = (binding?: PresenceBinding) => {
    if (lifetime.signal.aborted) return;
    for (const entry of active.values())
      if (
        !binding ||
        entry.step?.value.sourceId === binding.sourceId ||
        entry.rest?.some((place) => place.sourceId === binding.sourceId)
      )
        locate(entry, 'layout');
    safe(() => presentation.invalidate(binding?.sourceId));
  };
  const targets = createPresenceTargets(lifetime.signal, invalidateTargets, report);
  const presentation = createPresencePresentation(options, targets, report);
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
      entry = create(progress.actor);
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
    const shown = displayed(entry);
    // The cursor rests on a finished step, or on the last focused step of an earlier turn.
    const resting = entry.step ? isVacpExecutionSettled(entry.step.value) : entry.rest !== undefined;
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
      const waiting = entry;
      entry.hold = {
        shown,
        timer: setTimeout(() => {
          if (active.get(actorId) !== waiting) return;
          waiting.hold = undefined;
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
    const entry = active.get(actorId) ?? create(execution.actor);
    const read = captureVacpValue(execution);
    const value = read();
    if (entry.step?.value.id !== value.id) {
      // A first sighting in any phase starts a new shown step, releasing waits on the old one.
      moveOn(entry);
      entry.targets.cancel();
      entry.target = undefined;
      entry.heard = entry.progress?.summary;
      entry.step = { value, read, lifetime: new AbortController(), shared: read() === value };
    } else entry.step = { ...entry.step, value, read, shared: read() === value };
    if (value.intent && value.sourceId && entry.restFor !== value.id) {
      const at = { sourceId: value.sourceId, bindingId: value.bindingId };
      const places = stepPlaces(value.intent.focus, value.intent.affects, () => at);
      if (places.length) {
        entry.restFor = value.id;
        entry.rest = value.intent.focus || !entry.placed ? places : [...places, entry.placed];
      }
    }
    release(entry);
    if (!isVacpExecutionSettled(value)) clearTimeout(entry.retire);
    if (value.phase === 'prepared' || value.phase === 'running') locate(entry);
    if (value.phase === 'cancelled') {
      entry.step.lifetime.abort();
      entry.targets.stop();
      entry.target = undefined;
    }
    if (isVacpExecutionSettled(value) && entry.progress?.phase !== 'thinking') retire(actorId, entry);
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
    graph = observation.graph;
    if (!active.size) return;
    for (const entry of active.values()) {
      // Canvas and other surfaces can change geometry without a DOM layout event.
      if (entry.step?.value.phase !== 'failed' && entry.step?.value.phase !== 'cancelled') locate(entry);
      entry.freshness = freshnessOf(entry, observation);
    }
    // Target lookups publish their own result; an unchanged projection publishes nothing new.
    publish();
  };
  const subscriptions: Array<() => void> = [];
  try {
    subscriptions.push(source.subscribeExecutions(onExecution));
    subscriptions.push(source.subscribeAgentActivities(onActivity));
    for (const activity of source.getAgentActivities()) onActivity(activity);
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
    // Every actor leaves and the empty frame renders before the surfaces and presentation go away.
    for (const actorId of active.keys()) releaseActor(actorId);
    publish();
    targets.dispose();
    presentation.dispose();
    listeners.clear();
    latest.clear();
    safe(() => options.renderer?.dispose?.());
    source.signal.removeEventListener('abort', dispose);
  };
  source.signal.addEventListener('abort', dispose, { once: true });
  return {
    signal: lifetime.signal,
    getSnapshot: snapshot,
    /** The page scrolled or resized: every pointer and recorded frame looks its target up again. */
    invalidateTargets: () => invalidateTargets(),
    async arrive(executionId: string, signal: AbortSignal) {
      const entry = [...active.values()].find((value) => value.step?.value.id === executionId);
      const step = entry?.step;
      if (!entry || !step) return;
      const waiting = AbortSignal.any([signal, lifetime.signal, entry.lifetime.signal, step.lifetime.signal]);
      const shown = () => active.get(entry.actor.id) === entry && entry.step?.value.id === executionId;
      while (!waiting.aborted && shown()) {
        const pending = entry.targets.pending;
        if (pending) await untilAborted(pending, waiting);
        if (waiting.aborted || !shown()) return;
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
    attach(provider: VacpProvider, presentation: PresencePresentation) {
      const binding = { ...presentation, ...source.getProviderBinding(provider), sourceId: provider.source.id };
      return targets.attach(binding, () => {
        for (const [actorId, entry] of active) {
          if (entry.placed?.bindingId === binding.id) entry.placed = undefined;
          const rest = entry.rest?.filter((place) => place.bindingId !== binding.id);
          const stepped = entry.step?.value.bindingId === binding.id;
          if (!stepped && rest?.length === entry.rest?.length) continue;
          if (!stepped && rest?.length) {
            entry.rest = rest;
            locate(entry);
          } else if (entry.progress?.phase === 'thinking') {
            // The surface is gone; the actor's words stay while it has nowhere to rest.
            moveOn(entry);
            entry.rest = entry.restFor = undefined;
            locate(entry);
          } else releaseActor(actorId);
        }
        publish();
      });
    },
    dispose,
  };
}
