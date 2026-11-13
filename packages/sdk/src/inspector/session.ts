import { abortable, type VacpActionResult } from '../protocol';
import type {
  InspectorClient,
  InspectorAction,
  InspectorSession,
  InspectorSessionOptions,
  InspectorState,
} from './types';
import { asError } from './request';
import { snapshot } from './snapshot';
import { notify } from './notify';

export function createInspectorSession(
  client: InspectorClient,
  options: InspectorSessionOptions = {},
): InspectorSession {
  const limit = options.historyLimit ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('historyLimit must be a non-negative integer');
  let state: InspectorState = Object.freeze({
    status: 'idle',
    observation: null,
    observationError: null,
    records: Object.freeze([]),
    action: Object.freeze({ status: 'idle' as const }),
  });
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  let read: AbortController | undefined;
  let detach: (() => void) | undefined;
  let started = false;
  let recordId = 0;
  let queued = false;
  let invalidated = false;

  const publish = (patch: Partial<InspectorState>) => {
    if (lifetime.signal.aborted) return;
    state = Object.freeze({ ...state, ...patch });
    notify(listeners);
  };
  const refresh = async () => {
    lifetime.signal.throwIfAborted();
    read?.abort();
    const current = new AbortController();
    read = current;
    const signal = AbortSignal.any([lifetime.signal, current.signal]);
    publish({ status: 'loading', observationError: null });
    try {
      const observation = snapshot(await abortable(signal, () => client.observe({ signal })));
      if (signal.aborted) return;
      const changed = state.observation?.revision !== observation.revision;
      const records =
        changed && limit > 0
          ? Object.freeze([
              ...(limit === 1 ? [] : state.records.slice(-(limit - 1))),
              Object.freeze({ id: ++recordId, observation }),
            ])
          : state.records;
      publish({ observation, records, status: 'ready', observationError: null });
    } catch (error) {
      if (!signal.aborted) publish({ status: 'error', observationError: asError(error) });
    } finally {
      if (read === current) {
        read = undefined;
        if (invalidated) schedule();
      }
    }
  };
  // Coalesce invalidations and let the current read settle before reading again.
  const schedule = () => {
    if (lifetime.signal.aborted) return;
    invalidated = true;
    if (queued || read) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (lifetime.signal.aborted) return;
      invalidated = false;
      void refresh();
    });
  };
  const invoke = async (
    action: InspectorAction,
    run: (signal: AbortSignal) => Promise<VacpActionResult>,
    external?: AbortSignal,
  ) => {
    lifetime.signal.throwIfAborted();
    if (state.action.status === 'running') throw new Error('An action is already running');
    const signal = external ? AbortSignal.any([lifetime.signal, external]) : lifetime.signal;
    signal.throwIfAborted();
    publish({ action: Object.freeze({ status: 'running', action }) });
    let result: VacpActionResult;
    try {
      result = await abortable(signal, () => run(signal));
      signal.throwIfAborted();
    } catch (error) {
      publish({ action: Object.freeze({ status: 'error', action, error: asError(error) }) });
      schedule();
      throw error;
    }
    try {
      const captured = snapshot(result);
      publish({ action: Object.freeze({ status: 'complete', action, result: captured }) });
    } catch (error) {
      publish({ action: Object.freeze({ status: 'capture-error', action, error: asError(error) }) });
    }
    schedule();
    return result;
  };

  return {
    client,
    getState: () => state,
    subscribe(listener) {
      lifetime.signal.throwIfAborted();
      const subscription = () => listener();
      listeners.add(subscription);
      return () => {
        listeners.delete(subscription);
      };
    },
    start() {
      lifetime.signal.throwIfAborted();
      if (started) return;
      started = true;
      try {
        detach = client.subscribe?.(schedule);
        schedule();
      } catch (error) {
        started = false;
        publish({ status: 'error', observationError: asError(error) });
      }
    },
    refresh,
    async execute(call, controls = {}) {
      const execute = client.execute?.bind(client);
      if (!execute) throw new Error('This client does not support execution');
      if (!state.observation?.graph.actions.some((action) => action.name === call.name))
        throw new Error(`Unknown action: ${call.name}`);
      const action = Object.freeze({ kind: 'execute' as const, call: snapshot(call) });
      const captured = structuredClone(call);
      return invoke(action, (signal) => execute(captured, { signal }), controls.signal);
    },
    async restore(observation, controls = {}) {
      const restore = client.restore;
      if (!restore) throw new Error('This client does not support restoration');
      const captured = snapshot(observation);
      return invoke(
        Object.freeze({ kind: 'restore', observation: captured }),
        (signal) => restore.call(client, captured.state, { signal }),
        controls.signal,
      );
    },
    async reveal(ref, controls = {}) {
      const reveal = client.reveal?.bind(client);
      if (!reveal) throw new Error('This client does not support reveal');
      const signal = controls.signal ? AbortSignal.any([lifetime.signal, controls.signal]) : lifetime.signal;
      await abortable(signal, () => reveal(ref, { signal }));
    },
    clearHistory() {
      publish({ records: Object.freeze([]) });
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      const action =
        state.action.status === 'running'
          ? Object.freeze({
              status: 'error' as const,
              action: state.action.action,
              error: asError(lifetime.signal.reason),
            })
          : state.action;
      state = Object.freeze({ ...state, status: 'disposed', action });
      try {
        detach?.();
      } finally {
        notify(listeners);
        listeners.clear();
      }
    },
  };
}
