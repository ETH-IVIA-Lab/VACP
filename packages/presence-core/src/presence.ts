import type { VacpExecution, VacpObservation } from '@vacp/protocol';
import { validPresenceTarget } from './geometry.js';
import type { PresenceActivity, PresenceBinding, PresenceOptions, PresenceSource } from './types.js';

type Active = {
  activity: PresenceActivity;
  lookup?: AbortController;
  pending?: Promise<void>;
  retire?: ReturnType<typeof setTimeout>;
};

function terminal(execution: VacpExecution): boolean {
  return execution.phase === 'succeeded' || execution.phase === 'failed' || execution.phase === 'cancelled';
}

/** One independent viewer. Coalescing changes presentation only, never execution. */
export function createAgentPresence(source: PresenceSource, options: PresenceOptions = {}) {
  const maxActors = options.maxActors ?? 4;
  const lingerMs = options.lingerMs ?? 1600;
  if (!Number.isInteger(maxActors) || maxActors < 1) throw new Error('maxActors must be a positive integer');
  if (!Number.isFinite(lingerMs) || lingerMs < 0) throw new Error('lingerMs must be finite and non-negative');
  source.signal.throwIfAborted();
  const lifetime = new AbortController();
  const active = new Map<string, Active>();
  const latest = new Map<string, number>();
  const bindings = new Map<string, PresenceBinding>();
  const detachBindings = new Map<string, () => void>();
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
  const snapshot = () => structuredClone([...active.values()].map((entry) => entry.activity));
  const publish = () => {
    safe(() => options.renderer?.render(snapshot()));
    for (const listener of listeners) safe(() => listener(snapshot()));
  };
  const release = (actorId: string) => {
    const entry = active.get(actorId);
    entry?.lookup?.abort();
    clearTimeout(entry?.retire);
    active.delete(actorId);
  };
  const locate = (entry: Active) => {
    entry.lookup?.abort();
    const execution = entry.activity.execution;
    const focus = execution.intent?.focus;
    const binding = execution.bindingId ? bindings.get(execution.bindingId) : undefined;
    if (!focus || !binding || binding.signal.aborted || binding.sourceId !== execution.sourceId) {
      entry.activity.target = null;
      return;
    }
    const lookup = new AbortController();
    entry.lookup = lookup;
    const signal = AbortSignal.any([lookup.signal, binding.signal, lifetime.signal]);
    entry.pending = Promise.resolve()
      .then(() => binding.resolve(focus, { signal }))
      .then(
        (target) => {
          if (signal.aborted) return;
          entry.activity.target = target && validPresenceTarget(target) ? target : null;
          publish();
        },
        (error) => {
          if (signal.aborted) return;
          entry.activity.target = null;
          safe(() => {
            throw error;
          });
          publish();
        },
      );
  };
  const retire = (actorId: string, entry: Active) => {
    clearTimeout(entry.retire);
    entry.retire = setTimeout(() => {
      if (active.get(actorId) === entry) {
        release(actorId);
        publish();
      }
    }, lingerMs);
  };
  const onExecution = (execution: VacpExecution) => {
    if (options.include ? !options.include(execution) : execution.actor.kind !== 'agent') return;
    const actorId = execution.actor.id;
    if (execution.sequence < (latest.get(actorId) ?? -1)) return;
    latest.delete(actorId);
    latest.set(actorId, execution.sequence);
    while (latest.size > maxActors * 4) latest.delete(latest.keys().next().value!);
    // Accepted requests have no validated intention yet. Rejections still get a textual outcome.
    if (execution.phase === 'accepted') return;
    let entry = active.get(actorId);
    if (entry && entry.activity.execution.id !== execution.id) {
      if (execution.phase !== 'prepared' && !terminal(execution)) return;
      release(actorId);
      entry = undefined;
    }
    if (!entry) {
      if (execution.phase === 'running') return;
      while (active.size >= maxActors) release(active.keys().next().value!);
      entry = { activity: { execution, target: null, freshness: 'unknown' } };
      active.set(actorId, entry);
    }
    entry.activity.execution = execution;
    if (execution.phase === 'prepared') locate(entry);
    if (execution.phase === 'cancelled') {
      entry.lookup?.abort();
      entry.activity.target = null;
    }
    if (terminal(execution)) retire(actorId, entry);
    publish();
  };
  const onObservation = (observation: VacpObservation) => {
    for (const entry of active.values()) {
      // Canvas and other surfaces can change geometry without a DOM layout event.
      if (entry.activity.execution.phase !== 'failed' && entry.activity.execution.phase !== 'cancelled') locate(entry);
      if (entry.activity.execution.phase !== 'succeeded') continue;
      const refs = entry.activity.execution.intent?.affects ?? [];
      const statuses = refs.map((ref) => observation.freshness?.[ref]?.status);
      entry.activity.freshness = statuses.includes('error')
        ? 'error'
        : statuses.some((status) => status === 'stale' || status === 'running')
          ? 'updating'
          : statuses.length > 0 && statuses.every((status) => status === 'current')
            ? 'current'
            : 'unknown';
    }
    publish();
  };
  const subscriptions: Array<() => void> = [];
  try {
    subscriptions.push(source.subscribeExecutions(onExecution));
    subscriptions.push(source.subscribeSnapshots(({ observation }) => onObservation(observation)));
  } catch (error) {
    lifetime.abort();
    for (const release of subscriptions.reverse()) safe(release);
    safe(() => options.renderer?.dispose?.());
    throw error;
  }

  const dispose = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    for (const release of subscriptions.reverse()) safe(release);
    for (const detach of [...detachBindings.values()]) detach();
    for (const actorId of active.keys()) release(actorId);
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
    async arrive(executionId: string, signal: AbortSignal) {
      const entry = [...active.values()].find((value) => value.activity.execution.id === executionId);
      if (!entry) return;
      await entry.pending;
      if (signal.aborted || lifetime.signal.aborted || !entry.activity.target) return;
      await options.renderer?.arrive?.(executionId, AbortSignal.any([signal, lifetime.signal]));
    },
    subscribe(listener: (activities: readonly PresenceActivity[]) => void) {
      lifetime.signal.throwIfAborted();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach(binding: PresenceBinding) {
      lifetime.signal.throwIfAborted();
      binding.signal.throwIfAborted();
      if (bindings.has(binding.id)) throw new Error('Presentation binding is already attached');
      bindings.set(binding.id, binding);
      let unsubscribe: (() => void) | undefined;
      try {
        unsubscribe = binding.subscribe?.(() => {
          for (const entry of active.values()) if (entry.activity.execution.bindingId === binding.id) locate(entry);
        });
      } catch (error) {
        bindings.delete(binding.id);
        throw error;
      }
      const detach = () => {
        if (!bindings.delete(binding.id)) return;
        safe(() => unsubscribe?.());
        detachBindings.delete(binding.id);
        binding.signal.removeEventListener('abort', detach);
        for (const [actorId, entry] of active) if (entry.activity.execution.bindingId === binding.id) release(actorId);
        publish();
      };
      detachBindings.set(binding.id, detach);
      binding.signal.addEventListener('abort', detach, { once: true });
      if (binding.signal.aborted) detach();
      else for (const entry of active.values()) if (entry.activity.execution.bindingId === binding.id) locate(entry);
      return detach;
    },
    dispose,
  };
}
