import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type {
  VacpActionCall,
  VacpExecution,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpCapabilitiesRequest,
  VacpChangeSource,
  VacpHistoryEntry,
  VacpProvider,
  VacpRuntimeSnapshot,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/protocol';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { actionFailure } from '../action-registry';
import { createExecutionChannel } from './executions';
import { composeVacpProviders } from '../composition';
import { createRuntimeObserver } from './observer';
import type { VacpRuntime } from './types';
import { scopeCapabilitiesSnapshot } from './capabilities-scope';
import { buildStateUpdate } from './state-update';
import { entryMessage, entrySource, makeEntryId, notify } from './helpers';
import { createRuntimeHistory } from './history';
import { createLiveObservations } from './observations';

const stateRequestSchema = z.object({
  mode: z.enum(['auto', 'full', 'delta']).default('auto'),
  since: z.string().optional(),
  refs: z.array(vacpRefSchema).optional(),
  includeSummary: z.boolean().optional(),
});

const STATE_UPDATE_CACHE_LIMIT = 64;

/**
 * Live provider composition, semantic execution, and observation recording.
 */
export function createVacpRuntime(args: {
  providers: readonly VacpProvider[];
  sessionKey?: string;
  runtimeId?: string;
}): VacpRuntime {
  type AdapterUpdate = { providers: readonly VacpProvider[]; sessionKey?: string };

  const providers = new Map<string, VacpProvider>();
  for (const provider of args.providers) {
    if (providers.has(provider.source.id)) throw new Error(`Duplicate VACP source: ${provider.source.id}`);
    providers.set(provider.source.id, provider);
  }
  let adapter = composeVacpProviders([...providers.values()]);
  let sessionKey = args.sessionKey?.length ? args.sessionKey : null;

  const listeners = new Set<(entry: VacpHistoryEntry) => void>();
  const lifetime = new AbortController();
  const executions = createExecutionChannel(lifetime.signal);
  let executionSequence = 0;
  const bindingIds = new WeakMap<AbortSignal, string>();
  const providerLifetimes = new Map<string, AbortController>();
  const providerLeases = new Map<string, symbol>();
  const providerSignal = (id: string): AbortSignal => {
    let controller = providerLifetimes.get(id);
    if (!controller) {
      controller = new AbortController();
      providerLifetimes.set(id, controller);
    }
    return controller.signal;
  };
  const getProviderBinding = (provider: VacpProvider) => {
    lifetime.signal.throwIfAborted();
    if (providers.get(provider.source.id) !== provider) throw new Error('Provider is not attached to this runtime');
    const signal = providerSignal(provider.source.id);
    let id = bindingIds.get(signal);
    if (!id) {
      id = makeEntryId();
      bindingIds.set(signal, id);
    }
    return { id, signal: AbortSignal.any([lifetime.signal, signal]) };
  };
  const releaseProvider = (id: string): void => {
    providerLifetimes.get(id)?.abort();
    providerLifetimes.delete(id);
  };
  const observations = createLiveObservations(() => adapter.observe(), lifetime.signal);
  const ensureLive = observations.read;
  const hasSubscribers = () => listeners.size > 0 || observations.subscribed;
  const runtimeId = args.runtimeId?.trim() || makeEntryId();

  const history = createRuntimeHistory();

  const stateUpdateCache = new Map<string, VacpStateSnapshot>();

  const cacheStateSnapshot = (token: string, snapshot: VacpStateSnapshot): void => {
    if (!token) return;

    if (stateUpdateCache.has(token)) stateUpdateCache.delete(token);
    stateUpdateCache.set(token, snapshot);

    while (stateUpdateCache.size > STATE_UPDATE_CACHE_LIMIT) {
      const oldest = stateUpdateCache.keys().next().value;

      if (!oldest) break;
      stateUpdateCache.delete(oldest);
    }
  };

  let activeActions = 0;

  const record = (entry: VacpHistoryEntry): void => {
    if (entry.kind === 'snapshot' || entry.kind === 'action') {
      entry.observation = observations.current?.observation;
    }
    const captured = history.record(entry);
    notify(listeners, captured);
  };

  const followProviderInvalidations = () =>
    adapter.subscribe(() => {
      if (hasSubscribers()) {
        void ensureLive()
          .then(() => recordIfStateChanged('human', 'provider changed'))
          .catch(() => {});
      }
    });
  let detachProviderInvalidations = followProviderInvalidations();

  const { recordIfStateChanged, startObserving, stopObserving } = createRuntimeObserver({
    getLive: () => observations.current?.observation ?? null,
    ensureLive,
    record,
    shouldRecord: () => activeActions === 0,
  });

  const dispatch = async (
    inputCall: VacpActionCall,
    options?: VacpActionExecutionOptions & { source?: VacpChangeSource; message?: string },
  ): Promise<VacpActionResult> => {
    const call = structuredClone(inputCall);
    const requestedProviders = new Map(providers);
    let signal = AbortSignal.any([lifetime.signal, ...(options?.signal ? [options.signal] : [])]);
    const changeSource = entrySource(options?.source);
    const execution: VacpExecution = {
      id: makeEntryId(),
      sequence: ++executionSequence,
      callId: call.callId,
      name: call.name,
      actor: options?.actor
        ? structuredClone(options.actor)
        : {
            id: changeSource,
            kind: changeSource === 'agent' ? 'agent' : changeSource === 'system' ? 'system' : 'human',
          },
      phase: 'accepted',
      at: nowIso(),
    };
    let terminal = false;
    const emit = (phase: VacpExecution['phase'], message?: string) => {
      if (terminal) return;
      terminal = phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
      Object.assign(execution, { phase, at: nowIso(), message });
      executions.emit(execution);
    };
    let before: VacpStateSnapshot | undefined;
    emit('accepted');
    const onAbort = () => emit('cancelled', 'Execution cancelled; changes already applied are not rolled back');
    signal.addEventListener('abort', onAbort, { once: true });
    activeActions += 1;
    try {
      signal.throwIfAborted();
      const { observation: initial } = await ensureLive();
      const owner = initial.graph.ownership.actions[call.name];
      const provider = owner ? providers.get(owner) : undefined;
      if (!provider) throw new Error(`Unknown action: ${call.name}`);
      if (requestedProviders.get(owner) !== provider) throw new DOMException('Provider replaced', 'AbortError');
      const binding = getProviderBinding(provider);
      signal.removeEventListener('abort', onAbort);
      signal = AbortSignal.any([signal, binding.signal]);
      signal.addEventListener('abort', onAbort, { once: true });
      signal.throwIfAborted();
      execution.sourceId = owner;
      execution.bindingId = binding.id;
      execution.title = initial.graph.actions.find((action) => action.name === call.name)?.title;
      before = {
        version: initial.version,
        createdAt: initial.observedAt,
        state: initial.state,
        summary: initial.summary,
      };
      signal.throwIfAborted();
      const prepared = await provider.prepare(call, { ...options, signal });
      signal.throwIfAborted();
      execution.intent = prepared.intent;
      emit('prepared');
      const presentation = executions.present(execution, signal);
      if (presentation) await presentation;
      signal.throwIfAborted();
      emit('running');
      const result = await prepared.execute({ ...options, signal });
      signal.throwIfAborted();
      emit(result.ok ? 'succeeded' : 'failed', result.ok ? undefined : result.error.message);
      observations.invalidate();
      // A read failure after execution cannot turn an applied operation into a failed one.
      const after = await ensureLive().then(
        (value) => value.state,
        () => undefined,
      );
      signal.throwIfAborted();
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'action',
        source: entrySource(options?.source),
        message: entryMessage(options?.message),
        call,
        result,
        beforeState: before,
        afterState: after,
        capabilities: observations.current?.capabilities,
      });
      recordIfStateChanged(entrySource(options?.source), 'action completed');
      const completion = executions.present(execution, signal, 'after');
      if (completion) await completion;
      return result;
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        emit('cancelled', 'Execution cancelled; changes already applied are not rolled back');
        throw error;
      }
      const result = actionFailure(call, error);
      emit('failed', result.error.message);
      if (before) {
        observations.invalidate();
        const after = await ensureLive().then(
          (value) => value.state,
          () => undefined,
        );
        if (!signal.aborted)
          record({
            id: makeEntryId(),
            at: nowIso(),
            kind: 'action',
            source: changeSource,
            message: entryMessage(options?.message),
            call,
            result,
            beforeState: before,
            afterState: after,
            capabilities: observations.current?.capabilities,
          });
      }
      return result;
    } finally {
      signal.removeEventListener('abort', onAbort);
      activeActions -= 1;
    }
  };

  const replaceProviders = (next: readonly VacpProvider[], resetLifetimes = false): void => {
    // Acquire the new subscriptions before releasing the working composition.
    const nextAdapter = composeVacpProviders(next);
    const previous = [...providers.values()];
    const retained = new Set(next);
    observations.invalidate();
    detachProviderInvalidations();
    adapter.dispose({ providers: false });
    providers.clear();
    for (const provider of next) providers.set(provider.source.id, provider);
    adapter = nextAdapter;
    detachProviderInvalidations = followProviderInvalidations();
    for (const provider of previous) {
      if (resetLifetimes || !retained.has(provider)) releaseProvider(provider.source.id);
      if (!retained.has(provider)) provider.dispose?.();
    }
  };

  const updateAdapters = (next: AdapterUpdate, options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    replaceProviders(next.providers, true);
    providerLeases.clear();
    const nextSessionKey = next.sessionKey?.length ? next.sessionKey : null;
    const prevSessionKey = sessionKey;
    const sessionChanged = Boolean(nextSessionKey && nextSessionKey !== prevSessionKey);

    sessionKey = nextSessionKey ?? sessionKey;

    if (sessionChanged) {
      history.clear();
      observations.reset();
      stateUpdateCache.clear();

      if (hasSubscribers()) {
        stopObserving();
        startObserving({ source: 'system', message: 'observe' });
      }

      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'session',
        source: 'system',
        message: `session changed: ${prevSessionKey ?? '(unknown)'} -> ${nextSessionKey}`,
      });
    }

    void bridge
      .refresh?.({
        source: entrySource(options?.source),
        message: entryMessage(options?.message) ?? (sessionChanged ? 'session started' : 'bridge updated'),
      })
      .catch(() => {});
  };

  const removeProvider = (sourceId: string): void => {
    lifetime.signal.throwIfAborted();
    if (!providers.has(sourceId)) return;
    replaceProviders([...providers.values()].filter((provider) => provider.source.id !== sourceId));
    providerLeases.delete(sourceId);
    void ensureLive().catch(() => {});
  };

  const attachProviders = (incoming: readonly VacpProvider[]): (() => void) => {
    lifetime.signal.throwIfAborted();
    const ids = new Set(incoming.map((provider) => provider.source.id));
    if (ids.size !== incoming.length) throw new Error('Duplicate VACP source in attachment');
    const next = new Map(providers);
    for (const provider of incoming) next.set(provider.source.id, provider);
    if (incoming.some((provider) => providers.get(provider.source.id) !== provider)) {
      replaceProviders([...next.values()]);
      void ensureLive().catch(() => {});
    }
    const lease = Symbol();
    for (const id of ids) providerLeases.set(id, lease);
    return () => {
      if (lifetime.signal.aborted) return;
      const owned = new Set([...ids].filter((id) => providerLeases.get(id) === lease));
      if (!owned.size) return;
      replaceProviders([...providers.values()].filter((provider) => !owned.has(provider.source.id)));
      for (const id of owned) providerLeases.delete(id);
      void ensureLive().catch(() => {});
    };
  };

  async function getState(): Promise<VacpStateSnapshot>;
  async function getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  async function getState(request?: VacpStateRequest): Promise<VacpStateSnapshot | VacpStateUpdate> {
    const { state: current } = await ensureLive();
    recordIfStateChanged('system', 'observed state');

    if (!request) return structuredClone(current);

    const normalizedRequest = stateRequestSchema.parse(request);
    const baseline = normalizedRequest.since ? stateUpdateCache.get(normalizedRequest.since) : undefined;

    const { update, snapshot } = buildStateUpdate({
      current,
      request: normalizedRequest,
      baseline,
    });

    cacheStateSnapshot(update.token, snapshot);

    return structuredClone(update);
  }

  const bridge: VacpRuntime = {
    version: VACP_SCHEMA_VERSION,
    runtimeId,
    signal: lifetime.signal,
    get sessionKey() {
      return sessionKey ?? undefined;
    },
    get providerIds() {
      return [...providers.keys()];
    },
    attachProviders,
    getProviderBinding,
    subscribeExecutions: executions.subscribeExecutions,
    addExecutionGate: executions.addExecutionGate,
    removeProvider,
    update: (next) => updateAdapters(next, { source: 'system' }),
    dispose: () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      detachProviderInvalidations();
      adapter.dispose();
      providers.clear();
      providerLifetimes.clear();
      providerLeases.clear();
      observations.dispose();
      history.clear();
      stateUpdateCache.clear();
      stopObserving();
      listeners.clear();
    },

    observe: async () => structuredClone((await ensureLive()).observation),

    getCapabilities: async (request?: VacpCapabilitiesRequest) => {
      const { capabilities } = await ensureLive();

      if (!request) return structuredClone(capabilities);

      return structuredClone(scopeCapabilitiesSnapshot(capabilities, request));
    },

    getState,

    execute: async (call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult> => {
      return dispatch(call, { ...options, source: 'agent' });
    },

    getRuntime: async (): Promise<VacpRuntimeSnapshot> => {
      const { observation } = await ensureLive();
      recordIfStateChanged('system', 'observed state');

      return {
        version: VACP_SCHEMA_VERSION,
        runtimeId,
        sessionKey: sessionKey ?? undefined,
        history: history.snapshot(),
        observation: structuredClone(observation),
      };
    },

    subscribe: (listener) => {
      lifetime.signal.throwIfAborted();
      listeners.add(listener);

      if (listeners.size === 1) startObserving({ source: 'system', message: 'observe' });

      return () => {
        listeners.delete(listener);

        if (!hasSubscribers()) stopObserving();
      };
    },

    subscribeCapabilities: (listener) => {
      lifetime.signal.throwIfAborted();
      const release = observations.subscribeCapabilities(listener);
      startObserving();
      return () => {
        release();
        if (!hasSubscribers()) stopObserving();
      };
    },

    subscribeSnapshots: (listener) => {
      lifetime.signal.throwIfAborted();
      const release = observations.subscribeSnapshots(listener);
      startObserving();
      return () => {
        release();
        if (!hasSubscribers()) stopObserving();
      };
    },

    refresh: async (options?: { source?: VacpChangeSource; message?: string }): Promise<VacpStateSnapshot> => {
      observations.invalidate();
      const { state } = await ensureLive();

      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'snapshot',
        source: entrySource(options?.source),
        message: entryMessage(options?.message),
        capabilities: observations.current?.capabilities,
        state: observations.current?.state,
      });

      return structuredClone(state);
    },

    dispatch,
    startObserving: (options) => {
      lifetime.signal.throwIfAborted();
      startObserving(options);
    },
    stopObserving,
  };

  return bridge;
}
