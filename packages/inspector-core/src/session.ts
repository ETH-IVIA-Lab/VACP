import type { VacpActionResult } from '@vacp/protocol';
import type {
  InspectorClient,
  InspectorOperation,
  InspectorSession,
  InspectorSessionOptions,
  InspectorState,
} from './types';
import { asError, request } from './request';
import { snapshot } from './snapshot';
import { notify } from './notify';

export function createInspectorSession<Params = unknown, Result = unknown>(
  client: InspectorClient<Params, Result>,
  options: InspectorSessionOptions = {},
): InspectorSession<Params, Result> {
  const limit = options.historyLimit ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('historyLimit must be a non-negative integer');
  let state: InspectorState<Params, Result> = Object.freeze({
    status: 'idle',
    observation: null,
    observationError: null,
    records: Object.freeze([]),
    operation: Object.freeze({ status: 'idle' as const }),
  });
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  let read: AbortController | undefined;
  let detach: (() => void) | undefined;
  let started = false;
  let recordId = 0;
  let queued = false;
  let invalidated = false;

  const publish = (patch: Partial<InspectorState<Params, Result>>) => {
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
      const observation = snapshot(await request(signal, () => client.observe({ signal })));
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
    operation: InspectorOperation<Params>,
    run: (signal: AbortSignal) => Promise<VacpActionResult<Result>>,
    external?: AbortSignal,
  ) => {
    lifetime.signal.throwIfAborted();
    if (state.operation.status === 'running') throw new Error('An operation is already running');
    const signal = external ? AbortSignal.any([lifetime.signal, external]) : lifetime.signal;
    signal.throwIfAborted();
    publish({ operation: Object.freeze({ status: 'running', operation }) });
    let result: VacpActionResult<Result>;
    try {
      result = await request(signal, () => run(signal));
      signal.throwIfAborted();
    } catch (error) {
      publish({ operation: Object.freeze({ status: 'error', operation, error: asError(error) }) });
      schedule();
      throw error;
    }
    try {
      const captured = snapshot(result);
      publish({ operation: Object.freeze({ status: 'complete', operation, result: captured }) });
    } catch (error) {
      publish({ operation: Object.freeze({ status: 'capture-error', operation, error: asError(error) }) });
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
      const execute = client.execute;
      if (!execute) throw new Error('This client does not support execution');
      if (!state.observation?.graph.actions.some((action) => action.name === call.name))
        throw new Error(`Unknown operation: ${call.name}`);
      const operation = Object.freeze({ kind: 'execute' as const, call: snapshot(call) });
      const captured = structuredClone(call);
      return invoke(operation, (signal) => execute.call(client, captured, { signal }), controls.signal);
    },
    async restore(observation, controls = {}) {
      const restore = client.restore;
      if (!restore) throw new Error('This client does not support restoration');
      const captured = snapshot(observation);
      return invoke(
        Object.freeze({ kind: 'restore', observation: captured }),
        (signal) => restore.call(client, captured, { signal }),
        controls.signal,
      );
    },
    async reveal(ref, controls = {}) {
      const reveal = client.reveal;
      if (!reveal) throw new Error('This client does not support reveal');
      const signal = controls.signal ? AbortSignal.any([lifetime.signal, controls.signal]) : lifetime.signal;
      await request(signal, () => reveal.call(client, ref, { signal }));
    },
    clearHistory() {
      publish({ records: Object.freeze([]) });
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      const operation =
        state.operation.status === 'running'
          ? Object.freeze({
              status: 'error' as const,
              operation: state.operation.operation,
              error: asError(lifetime.signal.reason),
            })
          : state.operation;
      state = Object.freeze({ ...state, status: 'disposed', operation });
      try {
        detach?.();
      } finally {
        notify(listeners);
        listeners.clear();
      }
    },
  };
}
