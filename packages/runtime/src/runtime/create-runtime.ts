import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type {
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpHistoryEntry,
  VacpObservation,
  VacpProvider,
  VacpRuntimeMode,
  VacpRuntimeSnapshot,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/protocol';
import { stableStringify, nowIso, VACP_APPLY_STATE_ACTION, VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { composeVacpProviders } from '../composition';
import { createRuntimeObserver } from './observer';
import type { VacpRuntime, VacpLiveSnapshots } from './types';
import { scopeCapabilitiesSnapshot } from './capabilities-scope';
import { buildStateUpdate } from './state-update';
import {
  entryMessage,
  entrySource,
  findLatestIndexWithLiveState,
  findNextIndexWithState,
  findPrevIndexWithState,
  liveStateFromEntry,
  makeEntryId,
  notify,
  stateFromEntry,
} from './helpers';

const stateRequestSchema = z.object({
  mode: z.enum(['auto', 'full', 'delta']).default('auto'),
  since: z.string().optional(),
  refs: z.array(vacpRefSchema).optional(),
  includeSummary: z.boolean().optional(),
});

const STATE_UPDATE_CACHE_LIMIT = 64;

/**
 * Runtime bridge: wraps snapshots + actions with history/cursor time travel and optional overrides.
 * The live app remains the source of truth; overrides never mutate the app unless an action is executed.
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
  const providerLifetimes = new Map<string, AbortController>();
  const providerSignal = (id: string): AbortSignal => {
    let controller = providerLifetimes.get(id);
    if (!controller) {
      controller = new AbortController();
      providerLifetimes.set(id, controller);
    }
    return controller.signal;
  };
  const releaseProvider = (id: string): void => {
    providerLifetimes.get(id)?.abort();
    providerLifetimes.delete(id);
  };
  const capabilityListeners = new Set<(snapshot: VacpCapabilitiesSnapshot) => void>();
  const snapshotListeners = new Set<(snapshots: VacpLiveSnapshots) => void>();
  const hasSubscribers = () => listeners.size > 0 || capabilityListeners.size > 0 || snapshotListeners.size > 0;
  let snapshotKey: string | undefined;
  let capabilitiesKey: string | undefined;
  let providerRevision = 0;
  const runtimeId = args.runtimeId?.trim() || makeEntryId();

  let mode: VacpRuntimeMode = 'live';
  let cursor = -1;
  const history: VacpHistoryEntry[] = [];

  let liveCapabilities: VacpCapabilitiesSnapshot | null = null;
  let liveState: VacpStateSnapshot | null = null;
  let liveObservation: VacpObservation | null = null;
  let lastLiveState: VacpStateSnapshot | null = null;
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

  // Inspection-only overrides (do not affect live app state).
  let graphOverride: VacpCapabilitiesSnapshot | null = null;
  let stateOverride: VacpStateSnapshot | null = null;

  // When replaying time travel onto the host app, suppress observer-driven
  // snapshot recording so the timeline doesn't get polluted.
  let suppressObserverRecording = 0;
  let replayRequestId = 0;
  let stateReplayTail: Promise<void> = Promise.resolve();
  let liveReplayPromise: Promise<void> | null = null;

  const enqueueStateReplay = (run: () => Promise<void>): Promise<void> => {
    const replay = stateReplayTail.catch(() => undefined).then(run);
    stateReplayTail = replay.catch(() => undefined);

    return replay;
  };

  const scheduleCursorReplay = (requestId: number, targetCursor: number): void => {
    const replay = enqueueStateReplay(async () => {
      if (requestId !== replayRequestId || mode !== 'inspect' || cursor !== targetCursor) return;
      await replayCursorToApp(targetCursor);
    });

    void replay.catch(() => {
      if (requestId === replayRequestId) emitRuntimeChange({ source: 'system', message: 'inspect replay failed' });
    });
  };

  const emitRuntimeChange = (options?: { source?: VacpChangeSource; message?: string }): void => {
    notify(listeners, {
      id: makeEntryId(),
      at: nowIso(),
      kind: 'mode',
      source: entrySource(options?.source),
      message: entryMessage(options?.message) ?? 'runtime changed',
    });
  };

  const record = (entry: VacpHistoryEntry): void => {
    if (liveObservation && (entry.kind === 'snapshot' || entry.kind === 'action')) {
      entry.observation = liveObservation;
    }
    history.push(entry);
    notify(listeners, entry);

    if (mode === 'live') cursor = history.length - 1;
  };

  const ensureLive = async (): Promise<VacpLiveSnapshots> => {
    lifetime.signal.throwIfAborted();
    const revision = providerRevision;
    const beganLive = mode === 'live' && suppressObserverRecording === 0;
    let observation: VacpObservation;
    try {
      observation = await adapter.observe();
    } catch (error) {
      lifetime.signal.throwIfAborted();
      if (revision !== providerRevision) return ensureLive();
      throw error;
    }
    lifetime.signal.throwIfAborted();
    if (revision !== providerRevision) return ensureLive();
    const cap: VacpCapabilitiesSnapshot = {
      version: observation.version,
      createdAt: observation.observedAt,
      graph: observation.graph,
    };
    const st: VacpStateSnapshot = {
      version: observation.version,
      createdAt: observation.observedAt,
      state: observation.state,
      summary: observation.summary,
    };
    liveObservation = observation;
    liveCapabilities = cap;
    liveState = st;

    if (beganLive && mode === 'live' && suppressObserverRecording === 0) lastLiveState = st;

    if (capabilityListeners.size > 0 || snapshotListeners.size > 0) {
      const nextKey = stableStringify(cap.graph);
      const graphChanged = capabilitiesKey !== nextKey;
      capabilitiesKey = nextKey;
      if (graphChanged) notify(capabilityListeners, cap);
      if (snapshotListeners.size > 0) {
        const stateKey = observation.revision;
        if (graphChanged || stateKey !== snapshotKey) {
          snapshotKey = stateKey;
          notify(snapshotListeners, { observation, capabilities: cap, state: st });
        }
      }
    }
    return { observation, capabilities: cap, state: st };
  };

  const followProviderInvalidations = () =>
    adapter.subscribe(() => {
      if (hasSubscribers()) void ensureLive().catch(() => {});
    });
  let detachProviderInvalidations = followProviderInvalidations();

  const currentCapabilities = (): VacpCapabilitiesSnapshot => {
    if (!liveCapabilities) {
      return {
        version: VACP_SCHEMA_VERSION,
        createdAt: nowIso(),
        graph: {
          version: VACP_SCHEMA_VERSION,
          sources: [],
          ownership: { nodes: {}, actions: {} },
          nodes: [],
          edges: [],
          actions: [],
        },
      };
    }

    if (mode === 'inspect') {
      if (graphOverride) return graphOverride;
      const selected = history[cursor]?.observation;
      if (selected) return { version: selected.version, createdAt: selected.observedAt, graph: selected.graph };
    }

    return liveCapabilities;
  };

  const currentState = (): VacpStateSnapshot => {
    if (!liveState) return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: {} };

    if (mode === 'live') return liveState;

    if (stateOverride) return stateOverride;
    const idx = cursor >= 0 ? cursor : history.length - 1;
    const entry = idx >= 0 ? history[idx] : undefined;

    return entry ? (stateFromEntry(entry) ?? liveState) : liveState;
  };

  const currentObservation = (): VacpObservation => {
    const selected = mode === 'inspect' ? history[cursor]?.observation : undefined;
    const base = selected ?? liveObservation;
    const capabilities = currentCapabilities();
    const state = currentState();
    if (base && !graphOverride && !stateOverride) return base;
    return {
      version: VACP_SCHEMA_VERSION,
      revision: `inspection_${makeEntryId()}`,
      observedAt: nowIso(),
      graph: capabilities.graph,
      state: state.state,
      summary: state.summary,
    };
  };

  const canApplyState = (): boolean =>
    Boolean(liveCapabilities?.graph.actions.some((action) => action.name === VACP_APPLY_STATE_ACTION));

  const applyStateToApp = async (st: VacpStateSnapshot): Promise<void> => {
    if (!canApplyState()) return;
    suppressObserverRecording += 1;

    try {
      const call: VacpActionCall = {
        callId: makeEntryId(),
        name: VACP_APPLY_STATE_ACTION,
        params: { state: st.state },
      };

      const owner = liveObservation?.graph.ownership.actions[call.name];
      const signals = owner ? [lifetime.signal, providerSignal(owner)] : [lifetime.signal];
      await adapter.execute(call, { signal: AbortSignal.any(signals) });
      await ensureLive();
    } finally {
      suppressObserverRecording = Math.max(0, suppressObserverRecording - 1);
    }
  };

  const replayCursorToApp = async (targetCursor: number): Promise<void> => {
    if (mode !== 'inspect') return;

    if (!canApplyState()) return;
    const idx = targetCursor >= 0 ? targetCursor : history.length - 1;
    const entry = idx >= 0 ? history[idx] : undefined;
    const st = entry ? stateFromEntry(entry) : undefined;

    if (!st) return;

    await applyStateToApp(st);
  };

  const replayLatestToApp = async (): Promise<void> => {
    if (!canApplyState()) return;
    const idx = lastLiveState ? null : findLatestIndexWithLiveState(history);
    const entry = idx === null ? undefined : history[idx];
    const st = lastLiveState ?? (entry ? liveStateFromEntry(entry) : undefined);

    if (!st) return;
    await applyStateToApp(st);
  };

  const { recordIfStateChanged, startObserving, stopObserving } = createRuntimeObserver({
    getLive: () => liveObservation,
    ensureLive,
    record,
    shouldRecord: () => mode === 'live' && suppressObserverRecording === 0,
  });

  const setMode = (next: VacpRuntimeMode, options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    const requestId = ++replayRequestId;

    if (next === 'live') {
      if (!canApplyState()) {
        mode = 'live';
        cursor = history.length - 1;
        emitRuntimeChange(options);

        return;
      }

      const replay = enqueueStateReplay(async () => {
        if (requestId !== replayRequestId) return;
        await replayLatestToApp();
      });

      const done = replay
        .then(() => {
          if (requestId !== replayRequestId) return;
          mode = 'live';
          cursor = history.length - 1;
          emitRuntimeChange(options);
        })
        .catch(() => {
          if (requestId !== replayRequestId) return;
          emitRuntimeChange({ ...options, message: entryMessage(options?.message) ?? 'return to live failed' });
        });

      liveReplayPromise = done;
      void done.finally(() => {
        if (liveReplayPromise === done) liveReplayPromise = null;
      });

      return;
    }

    mode = next;

    if (cursor < 0) cursor = history.length - 1;
    emitRuntimeChange(options);

    if (mode === 'inspect') scheduleCursorReplay(requestId, cursor);
  };

  const setCursor = (nextCursor: number, options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    const requestId = ++replayRequestId;
    cursor = Math.max(-1, Math.min(nextCursor, history.length - 1));
    mode = 'inspect';
    emitRuntimeChange(options);
    scheduleCursorReplay(requestId, cursor);
  };

  const undo = (options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    const prev = findPrevIndexWithState(history, cursor - 1);

    if (prev === null) return;
    const requestId = ++replayRequestId;
    cursor = prev;
    mode = 'inspect';
    emitRuntimeChange(options);
    scheduleCursorReplay(requestId, cursor);
  };

  const redo = (options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    const next = findNextIndexWithState(history, cursor + 1);

    if (next === null) return;
    const requestId = ++replayRequestId;
    cursor = next;
    mode = 'inspect';
    emitRuntimeChange(options);
    scheduleCursorReplay(requestId, cursor);
  };

  const setStateOverrideMap = (
    next: Record<string, unknown>,
    options?: { source?: VacpChangeSource; message?: string },
  ) => {
    lifetime.signal.throwIfAborted();
    replayRequestId += 1;
    stateOverride = { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: next };
    mode = 'inspect';
    record({
      id: makeEntryId(),
      at: nowIso(),
      kind: 'state_override',
      source: entrySource(options?.source),
      message: entryMessage(options?.message),
      state: stateOverride ?? undefined,
      capabilities: liveCapabilities ?? undefined,
    });
    cursor = history.length - 1;
  };

  const setGraphOverrideGraph = (
    next: VacpCapabilitiesSnapshot['graph'],
    options?: { source?: VacpChangeSource; message?: string },
  ) => {
    lifetime.signal.throwIfAborted();
    replayRequestId += 1;

    const base = liveCapabilities ?? {
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: {
        version: VACP_SCHEMA_VERSION,
        sources: [],
        ownership: { nodes: {}, actions: {} },
        nodes: [],
        edges: [],
        actions: [],
      },
    };

    graphOverride = { ...base, createdAt: nowIso(), graph: next };
    mode = 'inspect';
    record({
      id: makeEntryId(),
      at: nowIso(),
      kind: 'graph_override',
      source: entrySource(options?.source),
      message: entryMessage(options?.message),
      capabilities: graphOverride,
      state: liveState ?? undefined,
    });
    cursor = history.length - 1;
  };

  const clearOverrides = (options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    graphOverride = null;
    stateOverride = null;
    emitRuntimeChange(options);
  };

  const dispatch = async (
    call: VacpActionCall,
    options?: VacpActionExecutionOptions & { source?: VacpChangeSource; message?: string },
  ): Promise<VacpActionResult> => {
    const requestedProviders = new Map(providers);
    const { observation: initial } = await ensureLive();
    const owner = initial.graph.ownership.actions[call.name];
    const provider = owner ? providers.get(owner) : undefined;
    if (!provider) return { callId: call.callId, ok: false, error: { message: `Unknown action: ${call.name}` } };
    if (requestedProviders.get(owner) !== provider) throw new DOMException('Provider replaced', 'AbortError');
    const signals = [lifetime.signal, providerSignal(owner)];
    if (options?.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    if (mode !== 'live') setMode('live', options);
    await stateReplayTail;

    if (liveReplayPromise) await liveReplayPromise;
    const { state: before } = await ensureLive();
    signal.throwIfAborted();
    const result = await provider.execute(call, { signal });
    signal.throwIfAborted();
    const { state: after } = await ensureLive();
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
      capabilities: liveCapabilities ?? undefined,
    });

    return result;
  };

  const updateAdapters = (next: AdapterUpdate, options?: { source?: VacpChangeSource; message?: string }): void => {
    lifetime.signal.throwIfAborted();
    const nextSources = new Set(next.providers.map((provider) => provider.source.id));
    if (nextSources.size !== next.providers.length) throw new Error('Duplicate VACP source in runtime update');
    providerRevision += 1;

    replayRequestId += 1;
    const nextSessionKey = next.sessionKey?.length ? next.sessionKey : null;
    const prevSessionKey = sessionKey;
    const sessionChanged = Boolean(nextSessionKey && nextSessionKey !== prevSessionKey);

    detachProviderInvalidations();
    for (const id of providers.keys()) releaseProvider(id);
    adapter.dispose({ providers: false });
    for (const previous of providers.values()) {
      if (!next.providers.includes(previous)) previous.dispose?.();
    }
    providers.clear();
    for (const provider of next.providers) providers.set(provider.source.id, provider);
    adapter = composeVacpProviders([...providers.values()]);
    detachProviderInvalidations = followProviderInvalidations();
    sessionKey = nextSessionKey ?? sessionKey;

    graphOverride = null;
    stateOverride = null;
    mode = 'live';

    if (!sessionChanged) cursor = history.length - 1;

    if (sessionChanged) {
      history.length = 0;
      suppressObserverRecording = 0;
      mode = 'live';
      cursor = -1;
      liveCapabilities = null;
      liveState = null;
      liveObservation = null;
      lastLiveState = null;
      stateUpdateCache.clear();

      if (hasSubscribers()) {
        stopObserving();
        startObserving({ source: 'system', message: 'observe' });
      }

      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'mode',
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

  const rebuildComposition = (): void => {
    providerRevision += 1;

    detachProviderInvalidations();
    adapter.dispose({ providers: false });
    adapter = composeVacpProviders([...providers.values()]);
    detachProviderInvalidations = followProviderInvalidations();
    void ensureLive().catch(() => {});
  };

  const attachProvider = (provider: VacpProvider): (() => void) => {
    lifetime.signal.throwIfAborted();
    const sourceId = provider.source.id;
    const previous = providers.get(sourceId);
    if (previous === provider) return () => {};
    releaseProvider(sourceId);
    previous?.dispose?.();
    providers.set(sourceId, provider);
    rebuildComposition();
    return () => {
      if (providers.get(sourceId) !== provider) return;
      releaseProvider(sourceId);
      providers.delete(sourceId);
      provider.dispose?.();
      rebuildComposition();
    };
  };

  async function getState(): Promise<VacpStateSnapshot>;
  async function getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  async function getState(request?: VacpStateRequest): Promise<VacpStateSnapshot | VacpStateUpdate> {
    const { state: current } = await ensureLive();
    recordIfStateChanged('system', 'observed state');

    if (!request) return current;

    const normalizedRequest = stateRequestSchema.parse(request);
    const baseline = normalizedRequest.since ? stateUpdateCache.get(normalizedRequest.since) : undefined;

    const { update, snapshot } = buildStateUpdate({
      current,
      request: normalizedRequest,
      baseline,
    });

    cacheStateSnapshot(update.token, snapshot);

    return update;
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
    attachProvider,
    removeProvider: (sourceId) => {
      const provider = providers.get(sourceId);
      if (!provider) return;
      releaseProvider(sourceId);
      providers.delete(sourceId);
      provider.dispose?.();
      rebuildComposition();
    },
    update: (next) => updateAdapters(next, { source: 'system' }),
    dispose: () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      detachProviderInvalidations();
      adapter.dispose();
      capabilityListeners.clear();
      snapshotListeners.clear();
      stopObserving();
      listeners.clear();
      replayRequestId += 1;
    },

    observe: async () => (await ensureLive()).observation,

    getCapabilities: async (request?: VacpCapabilitiesRequest) => {
      const { capabilities } = await ensureLive();

      if (!request) return capabilities;

      return scopeCapabilitiesSnapshot(capabilities, request);
    },

    getState,

    execute: async (call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult> => {
      return dispatch(call, { ...options, source: 'agent' });
    },

    getRuntime: async (): Promise<VacpRuntimeSnapshot> => {
      const { observation, capabilities: liveCap, state: liveSt } = await ensureLive();
      recordIfStateChanged('system', 'observed state');

      return {
        version: VACP_SCHEMA_VERSION,
        runtimeId,
        sessionKey: sessionKey ?? undefined,
        mode,
        cursor,
        history: [...history],
        liveObservation: observation,
        currentObservation: currentObservation(),
        liveCapabilities: liveCap,
        liveState: liveSt,
        currentCapabilities: currentCapabilities(),
        currentState: currentState(),
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
      capabilityListeners.add(listener);
      startObserving();
      return () => {
        capabilityListeners.delete(listener);
        if (!hasSubscribers()) stopObserving();
      };
    },

    subscribeSnapshots: (listener) => {
      lifetime.signal.throwIfAborted();
      snapshotListeners.add(listener);
      snapshotKey = undefined;
      startObserving();
      return () => {
        snapshotListeners.delete(listener);
        if (!hasSubscribers()) stopObserving();
      };
    },

    refresh: async (options?: { source?: VacpChangeSource; message?: string }): Promise<VacpStateSnapshot> => {
      const { state } = await ensureLive();

      if (mode !== 'live') return state;
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'snapshot',
        source: entrySource(options?.source),
        message: entryMessage(options?.message),
        capabilities: liveCapabilities ?? undefined,
        state: liveState ?? undefined,
      });

      return state;
    },

    setMode,
    setCursor,
    undo,
    redo,
    setStateOverride: (state, options) => setStateOverrideMap(state, options),
    setGraphOverride: (graph, options) => setGraphOverrideGraph(graph, options),
    clearOverrides,

    dispatch,
    startObserving: (options) => {
      lifetime.signal.throwIfAborted();
      startObserving(options);
    },
    stopObserving,
  };

  return bridge;
}
