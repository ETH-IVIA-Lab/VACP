import type {
  VacpActionCall,
  VacpActionResult,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpDemo,
  VacpHistoryEntry,
  VacpRuntimeBridge,
  VacpRuntimeMode,
  VacpRuntimeSnapshot,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { VacpActionRegistry } from '../action-registry';
import { createStateObserver } from './observer';
import type { VacpSnapshotProvider } from './types';
import {
  entryMessage,
  entrySource,
  findNextIndexWithState,
  findPrevIndexWithState,
  makeEntryId,
  notify,
  stateFromEntry,
} from './helpers';
/**
 * Runtime bridge implementation (concepts).
 *
 * This wraps a snapshot provider + action registry with:
 * - a lightweight history of snapshots/actions
 * - an inspectable "cursor" for time travel
 * - optional state/graph overrides for debugging
 *
 * The live app remains the source of truth; inspection and overrides do not
 * mutate the app unless an action is executed.
 */
export function createRuntimeBridge(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  demos?: VacpDemo[];
}): VacpRuntimeBridge {
  type Adapter = { snapshots: VacpSnapshotProvider; actions: VacpActionRegistry; demos?: VacpDemo[] };
  const adapter: Adapter = { ...args, demos: args.demos ?? [] };

  const listeners = new Set<(entry: VacpHistoryEntry) => void>();
  const runtimeId = makeEntryId();

  let mode: VacpRuntimeMode = 'live';
  let cursor = -1;
  const history: VacpHistoryEntry[] = [];

  let liveCapabilities: VacpCapabilitiesSnapshot | null = null;
  let liveState: VacpStateSnapshot | null = null;

  // Inspection-only overrides (do not affect live app state).
  let graphOverride: VacpCapabilitiesSnapshot | null = null;
  let stateOverride: VacpStateSnapshot | null = null;

  const record = (entry: VacpHistoryEntry): void => {
    history.push(entry);
    notify(listeners, entry);
    if (mode === 'live') cursor = history.length - 1;
  };

  const ensureLive = async (): Promise<void> => {
    const [cap, st] = await Promise.all([adapter.snapshots.getCapabilities(), adapter.snapshots.getState()]);
    liveCapabilities = cap;
    liveState = st;
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

  const { recordIfStateChanged, startObserving, stopObserving } = createStateObserver({
    getState: () => adapter.snapshots.getState(),
    getLive: () => ({ capabilities: liveCapabilities, state: liveState }),
    ensureLive,
    record,
  });

  const setMode = (next: VacpRuntimeMode, options?: { source?: VacpChangeSource; message?: string }): void => {
    mode = next;
    if (mode === 'live') cursor = history.length - 1;
    else if (cursor < 0) cursor = history.length - 1;
    void options;
  };

  const setCursor = (nextCursor: number, options?: { source?: VacpChangeSource; message?: string }): void => {
    cursor = Math.max(-1, Math.min(nextCursor, history.length - 1));
    mode = 'inspect';
    void options;
  };

  const undo = (options?: { source?: VacpChangeSource; message?: string }): void => {
    const prev = findPrevIndexWithState(history, cursor - 1);
    if (prev === null) return;
    cursor = prev;
    mode = 'inspect';
    void options;
  };

  const redo = (options?: { source?: VacpChangeSource; message?: string }): void => {
    const next = findNextIndexWithState(history, cursor + 1);
    if (next === null) return;
    cursor = next;
    mode = 'inspect';
    void options;
  };

  const setStateOverrideMap = (
    next: Record<string, unknown>,
    options?: { source?: VacpChangeSource; message?: string },
  ) => {
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
    void options;
  };

  const dispatch = async (
    call: VacpActionCall,
    options?: { source?: VacpChangeSource; message?: string },
  ): Promise<VacpActionResult> => {
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

  const updateAdapters = (next: Adapter, options?: { source?: VacpChangeSource; message?: string }): void => {
    adapter.snapshots = next.snapshots;
    adapter.actions = next.actions;
    adapter.demos = next.demos ?? [];
    graphOverride = null;
    stateOverride = null;
    mode = 'live';
    void bridge.refresh?.({
      source: entrySource(options?.source),
      message: entryMessage(options?.message) ?? 'bridge updated',
    });
  };

  const bridge: VacpRuntimeBridge = {
    version: VACP_SCHEMA_VERSION,

    getCapabilities: async () => {
      await ensureLive();
      return liveCapabilities as VacpCapabilitiesSnapshot;
    },

    getState: async () => {
      await ensureLive();
      recordIfStateChanged('system', 'observed state');
      return liveState as VacpStateSnapshot;
    },

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
        mode,
        cursor,
        history: [...history],
        liveCapabilities: liveCap,
        liveState: liveSt,
        currentCapabilities: currentCapabilities(),
        currentState: currentState(),
      };
    },

    getDemos: async () => adapter.demos ?? [],

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bridge as any).__vacpUpdate = (next: {
    snapshots: VacpSnapshotProvider;
    actions: VacpActionRegistry;
    demos?: VacpDemo[];
  }) => updateAdapters({ ...next, demos: next.demos ?? [] }, { source: 'system' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bridge as any).__vacpRuntimeId = runtimeId;

  startObserving({ source: 'system', message: 'observe' });

  return bridge;
}
