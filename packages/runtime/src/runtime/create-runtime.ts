import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type {
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpCapabilitiesRequest,
  VacpActor,
  VacpFocus,
  VacpProvider,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/protocol';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { createDispatcher } from './dispatch';
import { createAgentActivityChannel } from './activities';
import { createExecutionChannel } from './executions';
import { composeVacpProviders } from '../composition';
import { createRuntimeObserver } from './observer';
import type { VacpRuntime } from './types';
import { scopeCapabilitiesSnapshot } from './capabilities-scope';
import { buildStateUpdate } from './state-update';
import { entryMessage, entryActor, makeEntryId } from './helpers';
import { createProvenanceJournal } from './provenance';
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
  historyLimit?: number;
}): VacpRuntime {
  type AdapterUpdate = { providers: readonly VacpProvider[]; sessionKey?: string };

  const runtimeId = args.runtimeId?.trim() || makeEntryId();
  const provenance = createProvenanceJournal({
    runtimeId,
    sessionKey: args.sessionKey || undefined,
    limit: args.historyLimit,
  });
  const record = provenance.record;
  const providers = new Map<string, VacpProvider>();
  for (const provider of args.providers) {
    if (providers.has(provider.source.id)) throw new Error(`Duplicate VACP source: ${provider.source.id}`);
    providers.set(provider.source.id, provider);
  }
  let adapter = composeVacpProviders([...providers.values()]);
  let sessionKey = args.sessionKey?.length ? args.sessionKey : null;

  const lifetime = new AbortController();
  const executions = createExecutionChannel(lifetime.signal);
  const agentActivities = createAgentActivityChannel(lifetime.signal);
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
  const observations = createLiveObservations(() => adapter.read(), lifetime.signal);
  const ensureLive = observations.read;
  const hasSubscribers = () => provenance.subscribed || observations.subscribed;

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

  const {
    recordIfStateChanged,
    reset: resetObserver,
    acknowledge,
    startObserving,
    stopObserving,
    readObserved,
    actionStarted,
    actionFinished,
  } = createRuntimeObserver({ ensureLive, record });

  // One read follows a burst of invalidations; each read already observes the latest state.
  let following: { trailing: boolean } | undefined;
  const observeInvalidation = () => {
    if (!hasSubscribers()) return;
    if (following) {
      following.trailing = true;
      return;
    }
    const current = { trailing: false };
    following = current;
    const epoch = provenance.epoch;
    void readObserved()
      .then(({ inspection, cause }) => {
        if (epoch === provenance.epoch)
          recordIfStateChanged(inspection, { id: 'system', kind: 'system' }, 'Observed a change', cause);
      })
      .catch(() => {})
      .finally(() => {
        if (following === current) following = undefined;
        if (current.trailing && !lifetime.signal.aborted) observeInvalidation();
      });
  };
  const followProviderInvalidations = () => adapter.subscribe(observeInvalidation);
  let detachProviderInvalidations = followProviderInvalidations();

  const dispatch = createDispatcher({
    lifetime: lifetime.signal,
    providers,
    getProviderBinding,
    getEpoch: () => provenance.epoch,
    observations,
    executions,
    agentActivities,
    record,
    acknowledge,
    actionStarted,
    actionFinished,
  });

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

  const updateAdapters = (next: AdapterUpdate, options?: { actor?: VacpActor; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    replaceProviders(next.providers, true);
    providerLeases.clear();
    const nextSessionKey = next.sessionKey?.length ? next.sessionKey : null;
    const prevSessionKey = sessionKey;
    const sessionChanged = Boolean(nextSessionKey && nextSessionKey !== prevSessionKey);

    sessionKey = nextSessionKey ?? sessionKey;

    if (sessionChanged) {
      agentActivities.clear();
      const publishCancellations = executions.reset('Runtime session changed');
      resetObserver();
      observations.reset();
      stateUpdateCache.clear();
      provenance.reset(sessionKey ?? undefined);
      publishCancellations();

      if (hasSubscribers()) {
        stopObserving();
        startObserving({ actor: { id: 'system', kind: 'system' }, message: 'observe' });
      }

      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'session',
        actor: { id: 'system', kind: 'system' },
        message: `session changed: ${prevSessionKey ?? '(unknown)'} -> ${nextSessionKey}`,
      });
    }

    void bridge
      .refresh?.({
        actor: entryActor(options?.actor),
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
    const epoch = provenance.epoch;
    const { state: current, inspection, cause } = await readObserved();
    if (epoch === provenance.epoch)
      recordIfStateChanged(inspection, { id: 'system', kind: 'system' }, 'Observed state', cause);

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
    getActiveExecutions: executions.getActiveExecutions,
    beginAgentActivity: agentActivities.beginAgentActivity,
    getAgentActivities: agentActivities.getAgentActivities,
    subscribeAgentActivities: agentActivities.subscribeAgentActivities,
    addExecutionGate: executions.addExecutionGate,
    removeProvider,
    update: (next) => updateAdapters(next, { actor: { id: 'system', kind: 'system' } }),
    dispose: () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      detachProviderInvalidations();
      adapter.dispose();
      providers.clear();
      providerLifetimes.clear();
      providerLeases.clear();
      observations.dispose();
      provenance.dispose();
      stateUpdateCache.clear();
      stopObserving();
    },

    inspect: async () => structuredClone((await ensureLive()).inspection),
    observe: async () => structuredClone((await ensureLive()).observation),

    getCapabilities: async (request?: VacpCapabilitiesRequest) => {
      const { capabilities } = await ensureLive();

      if (!request) return structuredClone(capabilities);

      return structuredClone(scopeCapabilitiesSnapshot(capabilities, request));
    },

    getState,

    execute: async (call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult> => {
      return dispatch(call, { ...options, actor: options?.actor ?? { id: 'agent', kind: 'agent' } });
    },

    getProvenance: provenance.getProvenance,
    subscribeProvenance: (listener) => {
      lifetime.signal.throwIfAborted();
      const release = provenance.subscribeProvenance(listener);
      startObserving({ actor: { id: 'system', kind: 'system' }, message: 'observe' });
      return () => {
        release();
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

    refresh: async (options?: {
      actor?: VacpActor;
      message?: string;
      focus?: VacpFocus;
    }): Promise<VacpStateSnapshot> => {
      const captured = structuredClone(options ?? {});
      const epoch = provenance.epoch;
      observations.invalidate();
      const { state, inspection } = await ensureLive();
      if (epoch !== provenance.epoch) return structuredClone(state);
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'observation',
        cause: { kind: 'external' },
        actor: entryActor(captured.actor),
        message: entryMessage(captured.message),
        focus: captured.focus,
        observation: inspection,
      });
      acknowledge(inspection);
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
