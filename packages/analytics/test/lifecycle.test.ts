import { createVacpRuntime } from '@vacp/runtime';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpHistoryEntry, VacpRuntimeSnapshot } from '@vacp/protocol';
import { installVacpRuntimeAnalytics } from '../src/index';

test('telemetry replaces subscriptions without mutating the bridge or emitting disposed initialization', async () => {
  const listeners = new Set<(entry: VacpHistoryEntry) => void>();
  let resolveRuntime!: (runtime: VacpRuntimeSnapshot) => void;

  const pending = new Promise<VacpRuntimeSnapshot>((resolve) => {
    resolveRuntime = resolve;
  });

  const capabilities = {
    version: '0.1.0' as const,
    createdAt: '',
    graph: { version: '0.1.0' as const, nodes: [], edges: [], actions: [] },
  };

  const state = { version: '0.1.0' as const, createdAt: '', state: {} };

  const runtime = createVacpRuntime({
    runtimeId: 'runtime-1',
    snapshots: { getCapabilities: () => capabilities, getState: () => state },
    actions: { list: () => [], execute: async (call) => ({ callId: call.callId, ok: true }) },
  });

  const bridge = Object.freeze({
    ...runtime,
    getRuntime: () => pending,
    subscribe: (listener: (entry: VacpHistoryEntry) => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  });

  const firstEvents: string[] = [];
  const nextEvents: string[] = [];

  const first = installVacpRuntimeAnalytics({
    bridge,
    provider: { name: 'test', capture: (event) => firstEvents.push(event) },
  });

  const next = installVacpRuntimeAnalytics({
    bridge,
    provider: { name: 'test', capture: (event) => nextEvents.push(event) },
  });

  first.cleanup();
  assert.equal(listeners.size, 1);
  resolveRuntime({
    version: '0.1.0',
    runtimeId: 'runtime-1',
    mode: 'live',
    cursor: -1,
    history: [],
    liveCapabilities: capabilities,
    currentCapabilities: capabilities,
    liveState: state,
    currentState: state,
  });
  await Promise.resolve();

  for (const listener of listeners) listener({ id: 'event', at: '', kind: 'action', source: 'human' });
  assert.deepEqual(firstEvents, []);
  assert.deepEqual(nextEvents, ['vacp_runtime_init', 'vacp_action']);
  next.cleanup();
  assert.equal(listeners.size, 0);
});
