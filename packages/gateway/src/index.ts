import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpActionResult,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpHistoryEntry,
  VacpRuntimeBridge,
  VacpRuntimeMode,
  VacpRuntimeSnapshot,
  VacpStateSnapshot,
  VacpWindowBridge,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';

export type VacpActionHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * Action registry (concepts).
 *
 * Providers register *semantic* actions here (e.g. "set_interval_2d") rather
 * than wiring agents to DOM events. This is the core of the VACP "control
 * plane".
 *
 * Actions should be a small, explicit set of validated operations the UI
 * intentionally exposes; not arbitrary code execution.
 */
export class VacpActionRegistry {
  private readonly descriptors = new Map<string, VacpActionDescriptor>();
  private readonly handlers = new Map<string, VacpActionHandler>();

  register(descriptor: VacpActionDescriptor, handler: VacpActionHandler): void {
    if (this.handlers.has(descriptor.name)) {
      throw new Error(
        `Duplicate action registration for "${descriptor.name}". Register each action name once (handlers should route via params).`,
      );
    }
    this.descriptors.set(descriptor.name, descriptor);
    this.handlers.set(descriptor.name, handler);
  }

  unregister(name: string): void {
    this.descriptors.delete(name);
    this.handlers.delete(name);
  }

  list(): VacpActionDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  async execute(call: VacpActionCall): Promise<VacpActionResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return { callId: call.callId, ok: false, error: { message: `Unknown action: ${call.name}` } };
    }
    try {
      const result = await handler(call.params);
      return { callId: call.callId, ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { callId: call.callId, ok: false, error: { message, details: error } };
    }
  }
}

export interface VacpWindowBridgeOptions {
  globalKey?: string;
}

/**
 * Installs a VACP window bridge (default: `window.__vacp`).
 *
 * This is the preferred integration path for dynamic apps:
 * - the MCP server queries canonical JSON snapshots
 * - no DOM scanning is needed for discovery/state/control
 */
export function installVacpWindowBridge(bridge: VacpWindowBridge, options?: VacpWindowBridgeOptions): void {
  const key = options?.globalKey ?? '__vacp';
  (globalThis as unknown as Record<string, unknown>)[key] = bridge;
}

/**
 * Reads a previously-installed bridge from `window`.
 *
 * Consumers should treat the returned object as untrusted input if they did
 * not install it themselves.
 */
export function getVacpWindowBridge(options?: VacpWindowBridgeOptions): VacpWindowBridge | undefined {
  const key = options?.globalKey ?? '__vacp';
  const value = (globalThis as unknown as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object') return undefined;
  const bridge = value as VacpWindowBridge;
  return bridge.version === VACP_SCHEMA_VERSION ? bridge : bridge;
}

export interface VacpSnapshotProvider {
  getCapabilities(): VacpCapabilitiesSnapshot | Promise<VacpCapabilitiesSnapshot>;
  getState(): VacpStateSnapshot | Promise<VacpStateSnapshot>;
}

function makeEntryId(): string {
  const anyCrypto = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const uuid = anyCrypto.crypto?.randomUUID;
  if (typeof uuid === 'function') return uuid();
  return `vacp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function notify(listeners: Set<(entry: VacpHistoryEntry) => void>, entry: VacpHistoryEntry): void {
  listeners.forEach((fn) => {
    try {
      fn(entry);
    } catch {
      // ignore observer failures
    }
  });
}

function entrySource(source?: VacpChangeSource): VacpChangeSource {
  return source ?? 'system';
}

function entryMessage(message?: string): string | undefined {
  return message && message.trim() ? message.trim() : undefined;
}

function stateFromEntry(entry: VacpHistoryEntry): VacpStateSnapshot | undefined {
  return entry.state ?? entry.afterState ?? entry.beforeState;
}

function findPrevIndexWithState(history: VacpHistoryEntry[], startIdx: number): number | null {
  for (let i = Math.min(startIdx, history.length - 1); i >= 0; i--) {
    if (stateFromEntry(history[i])) return i;
  }
  return null;
}

function findNextIndexWithState(history: VacpHistoryEntry[], startIdx: number): number | null {
  for (let i = Math.max(0, startIdx); i < history.length; i++) {
    if (stateFromEntry(history[i])) return i;
  }
  return null;
}

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
function createRuntimeBridge({
  snapshots,
  actions,
}: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
}): VacpRuntimeBridge {
  const listeners = new Set<(entry: VacpHistoryEntry) => void>();

  let mode: VacpRuntimeMode = 'live';
  let cursor = -1;
  const history: VacpHistoryEntry[] = [];

  let liveCapabilities: VacpCapabilitiesSnapshot | null = null;
  let liveState: VacpStateSnapshot | null = null;

  // Inspection-only overrides (do not affect live app state).
  let graphOverride: VacpCapabilitiesSnapshot | null = null;
  let stateOverride: VacpStateSnapshot | null = null;

  function record(entry: VacpHistoryEntry): void {
    history.push(entry);
    notify(listeners, entry);
    if (mode === 'live') cursor = history.length - 1;
  }

  async function ensureLive(): Promise<void> {
    const [cap, st] = await Promise.all([snapshots.getCapabilities(), snapshots.getState()]);
    liveCapabilities = cap;
    liveState = st;
  }

  function currentCapabilities(): VacpCapabilitiesSnapshot {
    if (!liveCapabilities) {
      return {
        version: VACP_SCHEMA_VERSION,
        createdAt: nowIso(),
        graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: actions.list() },
      };
    }
    if (mode === 'inspect' && graphOverride) return graphOverride;
    return liveCapabilities;
  }

  function currentState(): VacpStateSnapshot {
    if (!liveState) return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: {} };
    if (mode === 'live') return liveState;
    if (stateOverride) return stateOverride;
    const idx = cursor >= 0 ? cursor : history.length - 1;
    const entry = idx >= 0 ? history[idx] : undefined;
    return entry ? stateFromEntry(entry) ?? liveState : liveState;
  }

  function setMode(next: VacpRuntimeMode, options?: { source?: VacpChangeSource; message?: string }): void {
    mode = next;
    if (mode === 'live') {
      cursor = history.length - 1;
      // Live mode ignores inspection-only overrides by design.
    } else {
      // Ensure the cursor points at something meaningful when entering inspect.
      if (cursor < 0) cursor = history.length - 1;
    }
    // Mode changes are UI/tooling concerns; do not append to the history
    // timeline, which is reserved for app snapshots and action/override events.
    void options;
  }

  function setCursor(nextCursor: number, options?: { source?: VacpChangeSource; message?: string }): void {
    const clamped = Math.max(-1, Math.min(nextCursor, history.length - 1));
    cursor = clamped;
    mode = 'inspect';
    void options;
  }

  function undo(options?: { source?: VacpChangeSource; message?: string }): void {
    const prev = findPrevIndexWithState(history, cursor - 1);
    if (prev === null) return;
    cursor = prev;
    mode = 'inspect';
    void options;
  }

  function redo(options?: { source?: VacpChangeSource; message?: string }): void {
    const next = findNextIndexWithState(history, cursor + 1);
    if (next === null) return;
    cursor = next;
    mode = 'inspect';
    void options;
  }

  function setStateOverrideMap(
    next: Record<string, unknown>,
    options?: { source?: VacpChangeSource; message?: string },
  ): void {
    stateOverride = { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: next as VacpStateSnapshot['state'] };
    mode = 'inspect';
    const entry: VacpHistoryEntry = {
      id: makeEntryId(),
      at: nowIso(),
      kind: 'state_override',
      source: entrySource(options?.source),
      message: entryMessage(options?.message),
      state: stateOverride,
      capabilities: liveCapabilities ?? undefined,
    };
    record(entry);
    cursor = history.length - 1;
  }

  function setGraphOverrideGraph(next: VacpCapabilitiesSnapshot['graph'], options?: { source?: VacpChangeSource; message?: string }): void {
    const base = liveCapabilities ?? {
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: [] },
    };
    graphOverride = { ...base, createdAt: nowIso(), graph: next };
    mode = 'inspect';
    const entry: VacpHistoryEntry = {
      id: makeEntryId(),
      at: nowIso(),
      kind: 'graph_override',
      source: entrySource(options?.source),
      message: entryMessage(options?.message),
      capabilities: graphOverride,
      state: liveState ?? undefined,
    };
    record(entry);
    cursor = history.length - 1;
  }

  function clearOverrides(options?: { source?: VacpChangeSource; message?: string }): void {
    graphOverride = null;
    stateOverride = null;
    void options;
  }

  const bridge: VacpRuntimeBridge = {
    version: VACP_SCHEMA_VERSION,

    getCapabilities: async () => {
      await ensureLive();
      return liveCapabilities as VacpCapabilitiesSnapshot;
    },

    getState: async () => {
      await ensureLive();
      return liveState as VacpStateSnapshot;
    },

    execute: async (call: VacpActionCall): Promise<VacpActionResult> => {
      await ensureLive();
      const before = liveState as VacpStateSnapshot;
      const result = await actions.execute(call);
      await ensureLive();
      const after = liveState as VacpStateSnapshot;
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'action',
        source: 'agent',
        call,
        result,
        beforeState: before,
        afterState: after,
        capabilities: liveCapabilities ?? undefined,
      });
      return result;
    },

    getRuntime: async (): Promise<VacpRuntimeSnapshot> => {
      await ensureLive();
      const liveCap = liveCapabilities as VacpCapabilitiesSnapshot;
      const liveSt = liveState as VacpStateSnapshot;
      return {
        version: VACP_SCHEMA_VERSION,
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
      return () => listeners.delete(listener);
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
  };

  return bridge;
}

/**
 * Helper to build a window bridge from a snapshot provider + action registry.
 * This is intended for in-browser integrations (e.g., Mosaic/vgplot).
 *
 * Conceptually this creates the "agent-facing API surface" for an app:
 * - capabilities() to discover nodes/actions
 * - state() to read current selections/params
 * - execute() to request semantic interactions
 */
export function createVacpWindowBridge({
  snapshots,
  actions,
}: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
}): VacpRuntimeBridge {
  return createRuntimeBridge({ snapshots, actions });
}
