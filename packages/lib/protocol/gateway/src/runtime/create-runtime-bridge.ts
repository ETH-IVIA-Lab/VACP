import type {
  VacpActionCall,
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
} from '@vacp/core';
import { nowIso, VACP_APPLY_STATE_ACTION, VACP_SCHEMA_VERSION } from '@vacp/core';
import { VacpActionRegistry } from '../action-registry';
import { createStateObserver } from './observer';
import type { VacpSnapshotProvider, VacpUpdatableRuntimeBridge } from './types';
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

const STATE_UPDATE_CACHE_LIMIT = 64;
/**
 * Runtime bridge: wraps snapshots + actions with history/cursor time travel and optional overrides.
 * The live app remains the source of truth; overrides never mutate the app unless an action is executed.
 */
export function createRuntimeBridge(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  sessionKey?: string;
  runtimeId?: string;
}): VacpUpdatableRuntimeBridge {
  type Adapter = { snapshots: VacpSnapshotProvider; actions: VacpActionRegistry };
  type AdapterUpdate = Adapter & { sessionKey?: string };
  const adapter: Adapter = { snapshots: args.snapshots, actions: args.actions };
  let sessionKey = typeof args.sessionKey === 'string' && args.sessionKey.length ? args.sessionKey : null;

  const listeners = new Set<(entry: VacpHistoryEntry) => void>();
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

  const ensureLive = async (): Promise<void> => {
    const [cap, st] = await Promise.all([adapter.snapshots.getCapabilities(), adapter.snapshots.getState()]);
    liveCapabilities = cap;
    liveState = st;
    if (mode === 'live' && suppressObserverRecording === 0) lastLiveState = st;
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
      await adapter.actions.execute(call);
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

  const { recordIfStateChanged, startObserving, stopObserving } = createStateObserver({
    getState: () => adapter.snapshots.getState(),
    getLive: () => ({ capabilities: liveCapabilities, state: liveState }),
    ensureLive,
    record,
    shouldRecord: () => mode === 'live' && suppressObserverRecording === 0,
  });

  const setMode = (next: VacpRuntimeMode, options?: { source?: VacpChangeSource; message?: string }): void => {
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
    const requestId = ++replayRequestId;
    cursor = Math.max(-1, Math.min(nextCursor, history.length - 1));
    mode = 'inspect';
    emitRuntimeChange(options);
    scheduleCursorReplay(requestId, cursor);
  };

  const undo = (options?: { source?: VacpChangeSource; message?: string }): void => {
    const prev = findPrevIndexWithState(history, cursor - 1);
    if (prev === null) return;
    const requestId = ++replayRequestId;
    cursor = prev;
    mode = 'inspect';
    emitRuntimeChange(options);
    scheduleCursorReplay(requestId, cursor);
  };

  const redo = (options?: { source?: VacpChangeSource; message?: string }): void => {
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
    replayRequestId += 1;
    stateOverride = { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: next as VacpStateSnapshot['state'] };
    mode = 'inspect';
    record({
      id: makeEntryId(),
      at: nowIso(),
      kind: 'state_override',
      source: entrySource(options?.source),
      message: entryMessage(options?.message),
      state: stateOverride,
      capabilities: liveCapabilities ?? undefined,
    });
    cursor = history.length - 1;
  };

  const setGraphOverrideGraph = (
    next: VacpCapabilitiesSnapshot['graph'],
    options?: { source?: VacpChangeSource; message?: string },
  ) => {
    replayRequestId += 1;
    const base =
      liveCapabilities ??
      ({
        version: VACP_SCHEMA_VERSION,
        createdAt: nowIso(),
        graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: [] },
      } as VacpCapabilitiesSnapshot);
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
    graphOverride = null;
    stateOverride = null;
    emitRuntimeChange(options);
  };

  const dispatch = async (
    call: VacpActionCall,
    options?: { source?: VacpChangeSource; message?: string },
  ): Promise<VacpActionResult> => {
    await stateReplayTail;
    if (liveReplayPromise) await liveReplayPromise;
    await ensureLive();
    const before = liveState as VacpStateSnapshot;
    const result = await adapter.actions.execute(call);
    await ensureLive();
    const after = liveState as VacpStateSnapshot;
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
    replayRequestId += 1;
    const nextSessionKey = typeof next.sessionKey === 'string' && next.sessionKey.length ? next.sessionKey : null;
    const prevSessionKey = sessionKey;
    const sessionChanged = Boolean(nextSessionKey && nextSessionKey !== prevSessionKey);

    adapter.snapshots = next.snapshots;
    adapter.actions = next.actions;
    sessionKey = nextSessionKey ?? sessionKey;
    bridge.__vacpSessionKey = sessionKey ?? undefined;

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
      if (listeners.size > 0) {
        stopObserving();
        startObserving({ source: 'system', message: 'observe' });
      }
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'mode',
        source: 'system',
        message: `session changed: ${prevSessionKey ?? '(unknown)'} → ${nextSessionKey}`,
      });
    }

    void bridge.refresh?.({
      source: entrySource(options?.source),
      message: entryMessage(options?.message) ?? (sessionChanged ? 'session started' : 'bridge updated'),
    });
  };

  async function getState(): Promise<VacpStateSnapshot>;
  async function getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  async function getState(request?: VacpStateRequest): Promise<VacpStateSnapshot | VacpStateUpdate> {
    await ensureLive();
    recordIfStateChanged('system', 'observed state');
    const current = liveState as VacpStateSnapshot;
    if (!request) return current;

    const normalizedRequest: VacpStateRequest = {
      mode: request.mode ?? 'auto',
      ...(typeof request.since === 'string' && request.since.length ? { since: request.since } : {}),
      ...(Array.isArray(request.refs) ? { refs: request.refs } : {}),
      ...(typeof request.includeSummary === 'boolean' ? { includeSummary: request.includeSummary } : {}),
    };

    const baseline =
      typeof normalizedRequest.since === 'string'
        ? (stateUpdateCache.get(normalizedRequest.since) ?? undefined)
        : undefined;

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

  const bridge: VacpUpdatableRuntimeBridge = {
    version: VACP_SCHEMA_VERSION,

    getCapabilities: async (request?: VacpCapabilitiesRequest) => {
      await ensureLive();
      const capabilities = liveCapabilities as VacpCapabilitiesSnapshot;
      if (!request) return capabilities;
      return scopeCapabilitiesSnapshot(capabilities, request);
    },

    getState,

    execute: async (call: VacpActionCall): Promise<VacpActionResult> => {
      return dispatch(call, { source: 'agent' });
    },

    getRuntime: async (): Promise<VacpRuntimeSnapshot> => {
      await ensureLive();
      recordIfStateChanged('system', 'observed state');
      const liveCap = liveCapabilities as VacpCapabilitiesSnapshot;
      const liveSt = liveState as VacpStateSnapshot;
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
      listeners.add(listener);
      if (listeners.size === 1) startObserving({ source: 'system', message: 'observe' });
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopObserving();
      };
    },

    refresh: async (options?: { source?: VacpChangeSource; message?: string }): Promise<VacpStateSnapshot> => {
      await ensureLive();
      if (mode !== 'live') return liveState as VacpStateSnapshot;
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'snapshot',
        source: entrySource(options?.source),
        message: entryMessage(options?.message),
        capabilities: liveCapabilities ?? undefined,
        state: liveState ?? undefined,
      });
      return liveState as VacpStateSnapshot;
    },

    setMode,
    setCursor,
    undo,
    redo,
    setStateOverride: (state, options) => setStateOverrideMap(state as unknown as Record<string, unknown>, options),
    setGraphOverride: (graph, options) => setGraphOverrideGraph(graph, options),
    clearOverrides,

    dispatch,
    startObserving,
    stopObserving,
  };

  bridge.__vacpUpdate = (next) => updateAdapters({ ...next, sessionKey: next.sessionKey }, { source: 'system' });
  bridge.__vacpRuntimeId = runtimeId;
  bridge.__vacpSessionKey = sessionKey ?? undefined;

  return bridge;
}
