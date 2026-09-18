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
  VacpRuntimeMode,
  VacpRuntimeSnapshot,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/protocol';
import { stableStringify, nowIso, VACP_APPLY_STATE_ACTION, VACP_SCHEMA_VERSION } from '@vacp/protocol';
import type { VacpActionExecutor } from '../action-registry';
import { createRuntimeObserver } from './observer';
import type { VacpSnapshotProvider, VacpRuntime, VacpLiveSnapshots } from './types';
import { scopeCapabilitiesSnapshot } from './capabilities-scope';
import { buildStateUpdate, computeStateToken, scopeStateSnapshot } from './state-update';
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
  snapshots: VacpSnapshotProvider;
  actions: VacpActionExecutor;
  sessionKey?: string;
  runtimeId?: string;
}): VacpRuntime {
  type Adapter = { snapshots: VacpSnapshotProvider; actions: VacpActionExecutor };

  type AdapterUpdate = Adapter & { sessionKey?: string };

  const adapter: Adapter = { snapshots: args.snapshots, actions: args.actions };
  let sessionKey = args.sessionKey?.length ? args.sessionKey : null;

  const listeners = new Set<(entry: VacpHistoryEntry) => void>();
  const lifetime = new AbortController();
  let providerLifetime = new AbortController();
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
    history.push(entry);
    notify(listeners, entry);

    if (mode === 'live') cursor = history.length - 1;
  };

  const ensureLive = async (): Promise<VacpLiveSnapshots> => {
    lifetime.signal.throwIfAborted();
    const revision = providerRevision;
    const [cap, st] = await Promise.all([adapter.snapshots.getCapabilities(), adapter.snapshots.getState()]);
    lifetime.signal.throwIfAborted();
    if (revision !== providerRevision) return ensureLive();
    liveCapabilities = cap;
    liveState = st;

    if (mode === 'live' && suppressObserverRecording === 0) lastLiveState = st;

    if (capabilityListeners.size > 0 || snapshotListeners.size > 0) {
      const nextKey = stableStringify(cap.graph);
      const graphChanged = capabilitiesKey !== nextKey;
      capabilitiesKey = nextKey;
      if (graphChanged) notify(capabilityListeners, cap);
      if (snapshotListeners.size > 0) {
        const stateKey = stableStringify({ state: st.state, summary: st.summary });
        if (graphChanged || stateKey !== snapshotKey) {
          snapshotKey = stateKey;
          notify(snapshotListeners, { capabilities: cap, state: st });
        }
      }
    }
    return { capabilities: cap, state: st };
  };

  const currentCapabilities = (): VacpCapabilitiesSnapshot => {
    if (!liveCapabilities) {
      return {
        version: VACP_SCHEMA_VERSION,
        createdAt: nowIso(),
        graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: adapter.actions.list() },
      };
    }

    if (mode === 'inspect' && graphOverride) return graphOverride;

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

  const canApplyState = (): boolean => adapter.actions.list().some((x) => x.name === VACP_APPLY_STATE_ACTION);

  const applyStateToApp = async (st: VacpStateSnapshot): Promise<void> => {
    if (!canApplyState()) return;
    suppressObserverRecording += 1;

    try {
      const call: VacpActionCall = {
        callId: makeEntryId(),
        name: VACP_APPLY_STATE_ACTION,
        params: { state: st.state },
      };

      await adapter.actions.execute(call, { signal: AbortSignal.any([lifetime.signal, providerLifetime.signal]) });
      await ensureLive();
    } finally {
      suppressObserverRecording = Math.max(0, suppressObserverRecording - 1);
    }
  };

  const replayCursorToApp = async (targetCursor: number): Promise<void> => {
    if (mode !== 'inspect') return;

    if (!adapter.actions.list().some((x) => x.name === VACP_APPLY_STATE_ACTION)) return;
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
    getLive: () => ({ capabilities: liveCapabilities, state: liveState }),
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
      graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: [] },
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
    const executionRevision = providerRevision;
    const signals = [lifetime.signal, providerLifetime.signal];
    if (options?.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    if (mode !== 'live') setMode('live', options);
    await stateReplayTail;

    if (liveReplayPromise) await liveReplayPromise;
    const { state: before } = await ensureLive();
    signal.throwIfAborted();
    const result = await adapter.actions.execute(call, { signal });
    if (executionRevision !== providerRevision) signal.throwIfAborted();
    const { state: after } = await ensureLive();
    if (executionRevision !== providerRevision) signal.throwIfAborted();
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
    providerRevision += 1;
    providerLifetime.abort();
    providerLifetime = new AbortController();
    replayRequestId += 1;
    const nextSessionKey = next.sessionKey?.length ? next.sessionKey : null;
    const prevSessionKey = sessionKey;
    const sessionChanged = Boolean(nextSessionKey && nextSessionKey !== prevSessionKey);

    adapter.snapshots = next.snapshots;
    adapter.actions = next.actions;
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

  async function getState(): Promise<VacpStateSnapshot>;
  async function getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  async function getState(request?: VacpStateRequest): Promise<VacpStateSnapshot | VacpStateUpdate> {
    const { state: current } = await ensureLive();
    recordIfStateChanged('system', 'observed state');

    if (!request) return current;

    const normalizedRequest = stateRequestSchema.parse(request);
    const baseline = normalizedRequest.since ? stateUpdateCache.get(normalizedRequest.since) : undefined;

    const update = buildStateUpdate({
      current,
      request: normalizedRequest,
      baseline,
    });

    const scoped = scopeStateSnapshot(current, normalizedRequest).snapshot;
    const token = computeStateToken(scoped);
    cacheStateSnapshot(token, scoped);

    return update;
  }

  const bridge: VacpRuntime = {
    version: VACP_SCHEMA_VERSION,
    runtimeId,
    signal: lifetime.signal,
    get sessionKey() {
      return sessionKey ?? undefined;
    },
    update: (next) => updateAdapters(next, { source: 'system' }),
    dispose: () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      capabilityListeners.clear();
      snapshotListeners.clear();
      stopObserving();
      listeners.clear();
      replayRequestId += 1;
    },

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
      const { capabilities: liveCap, state: liveSt } = await ensureLive();
      recordIfStateChanged('system', 'observed state');

      return {
        version: VACP_SCHEMA_VERSION,
        runtimeId,
        sessionKey: sessionKey ?? undefined,
        mode,
        cursor,
        history: [...history],
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
