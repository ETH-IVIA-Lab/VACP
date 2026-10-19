import { vacpAgentActor } from '@ethivia/vacp-protocol';
import { parseCapabilitiesRequest, parseStateRequest } from '@ethivia/vacp-protocol/validation';
import type { VacpProvider, VacpStateSnapshot } from '@ethivia/vacp-protocol';
import { VACP_SCHEMA_VERSION } from '@ethivia/vacp-protocol';
import { createDispatcher } from './dispatch';
import { createAgentActivityChannel } from './activities';
import { createExecutionChannel } from './executions';
import { composeVacpProviders } from '../composition';
import { createObservationRecorder } from './observer';
import type { VacpRuntime } from './types';
import { scopeCapabilitiesSnapshot } from './capabilities-scope';
import { buildStateUpdate } from './state-update';
import { entryMessage, entryActor, makeEntryId, nowIso, systemActor } from './helpers';
import { createProvenanceJournal } from './provenance';
import { createLiveObservations } from './observations';

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
  let sessionKey = args.sessionKey || undefined;

  const lifetime = new AbortController();
  const executions = createExecutionChannel(lifetime.signal);
  // A finished turn is recorded, so replay can show the request from its opening words to its conclusion.
  const agentActivities = createAgentActivityChannel(lifetime.signal, {
    ended: (activity, { opening, closing }) => {
      if (lifetime.signal.aborted) return;
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'turn',
        actor: activity.actor,
        activityId: activity.id,
        outcome: activity.phase,
        opening,
        message: closing,
      });
    },
    busy: (actorId) => executions.getActiveExecutions().some((execution) => execution.actor.id === actorId),
  });
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
    stateUpdateCache.delete(token);
    stateUpdateCache.set(token, snapshot);
    for (const oldest of stateUpdateCache.keys()) {
      if (stateUpdateCache.size <= STATE_UPDATE_CACHE_LIMIT) break;
      stateUpdateCache.delete(oldest);
    }
  };

  const recorder = createObservationRecorder({ ensureLive, record });

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
    void recorder
      .readObserved()
      .then(({ inspection, cause }) => {
        if (epoch === provenance.epoch && hasSubscribers()) recorder.recordChange(inspection, cause);
      })
      .catch(() => {})
      .finally(() => {
        if (following === current) following = undefined;
        if (current.trailing && !lifetime.signal.aborted) observeInvalidation();
      });
  };
  const followProviderInvalidations = () => adapter.subscribe(observeInvalidation);
  let detachProviderInvalidations = followProviderInvalidations();

  // A first subscriber needs a baseline, so the first invalidation it follows can record a change.
  const followed =
    <Listener>(subscribe: (listener: Listener) => () => void) =>
    (listener: Listener) => {
      lifetime.signal.throwIfAborted();
      const first = !hasSubscribers();
      const release = subscribe(listener);
      if (first) {
        const epoch = provenance.epoch;
        void recorder
          .readObserved()
          .then(({ inspection }) => {
            if (epoch === provenance.epoch && hasSubscribers()) recorder.prime(inspection);
          })
          .catch(() => {});
      }
      return () => {
        release();
        if (!hasSubscribers()) recorder.forget();
      };
    };

  const dispatch = createDispatcher({
    lifetime: lifetime.signal,
    providers,
    getProviderBinding,
    getEpoch: () => provenance.epoch,
    observations,
    executions,
    agentActivities,
    record,
    acknowledge: recorder.acknowledge,
    actionStarted: recorder.actionStarted,
    actionFinished: recorder.actionFinished,
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

  const update: VacpRuntime['update'] = (next) => {
    lifetime.signal.throwIfAborted();
    replaceProviders(next.providers, true);
    providerLeases.clear();
    const previous = sessionKey;
    const sessionChanged = Boolean(next.sessionKey && next.sessionKey !== previous);
    sessionKey = next.sessionKey || sessionKey;

    if (sessionChanged) {
      agentActivities.clear();
      const publishCancellations = executions.reset('Runtime session changed');
      recorder.reset();
      observations.reset();
      stateUpdateCache.clear();
      provenance.reset(sessionKey);
      publishCancellations();
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'session',
        actor: systemActor(),
        message: `session changed: ${previous ?? '(unknown)'} -> ${sessionKey}`,
      });
    }

    void bridge
      .refresh({ actor: systemActor(), message: sessionChanged ? 'session started' : 'bridge updated' })
      .catch(() => {});
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

  const getState: VacpRuntime['getState'] = async (request = {}) => {
    const parsed = parseStateRequest(request);
    const { state: current } = await ensureLive();
    const baseline = parsed.since ? stateUpdateCache.get(parsed.since) : undefined;
    const { update, snapshot } = buildStateUpdate({ current, request: parsed, baseline });
    cacheStateSnapshot(update.token, snapshot);
    return structuredClone(update);
  };

  const bridge: VacpRuntime = {
    version: VACP_SCHEMA_VERSION,
    runtimeId,
    signal: lifetime.signal,
    get sessionKey() {
      return sessionKey;
    },
    get providerIds() {
      return [...providers.keys()];
    },
    attachProviders,
    getProviderBinding,
    subscribeExecutions: executions.subscribeExecutions,
    getActiveExecutions: executions.getActiveExecutions,
    beginAgentActivity: agentActivities.beginAgentActivity,
    narrate: agentActivities.narrate,
    getAgentActivities: agentActivities.getAgentActivities,
    subscribeAgentActivities: agentActivities.subscribeAgentActivities,
    addExecutionGate: executions.addExecutionGate,
    update,
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
      recorder.reset();
    },

    inspect: async () => structuredClone((await ensureLive()).inspection),
    observe: async () => structuredClone((await ensureLive()).observation),

    getCapabilities: async (request) => {
      const scope = request && parseCapabilitiesRequest(request);
      const { capabilities } = await ensureLive();
      return structuredClone(scope ? scopeCapabilitiesSnapshot(capabilities, scope) : capabilities);
    },

    getState,

    execute: (call, options) => dispatch(call, { ...options, actor: options?.actor ?? vacpAgentActor }),

    getProvenance: provenance.getProvenance,
    subscribeProvenance: followed(provenance.subscribeProvenance),
    subscribeCapabilities: followed(observations.subscribeCapabilities),
    subscribeSnapshots: followed(observations.subscribeSnapshots),

    refresh: async (options) => {
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
      recorder.acknowledge(inspection);
      return structuredClone(state);
    },
  };

  return bridge;
}
