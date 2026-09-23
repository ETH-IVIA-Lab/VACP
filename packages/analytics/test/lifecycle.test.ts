import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@vacp/runtime';
import assert from 'node:assert/strict';
import test from 'node:test';
import { installVacpRuntimeAnalytics } from '../src/index';

function fixture() {
  const actions = new VacpActionRegistry();
  actions.register({ name: 'change', description: 'Change', operation: { kind: 'mutation' } }, () => 1);
  const provider = createVacpProvider({
    source: { id: 'vacp-source://analytics-test', type: 'test', title: 'Analytics test' },
    actions,
    project: () => ({ graph: { version: '0.1.0', nodes: [], edges: [], actions: actions.list() }, state: {} }),
  });
  return { provider, runtime: createVacpRuntime({ runtimeId: 'runtime-1', providers: [provider] }) };
}

test('telemetry replaces subscriptions and old cleanup cannot detach its successor', async (t) => {
  const { runtime } = fixture();
  t.after(() => runtime.dispose());
  const bridge = Object.freeze({ ...runtime });
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
  t.after(() => next.cleanup());
  first.cleanup();
  await runtime.execute({ callId: 'change', name: 'change' });
  assert.deepEqual(firstEvents, ['vacp_runtime_init']);
  assert.deepEqual(nextEvents, ['vacp_runtime_init', 'vacp_action']);
  next.cleanup();
  await runtime.execute({ callId: 'next', name: 'change' });
  assert.equal(nextEvents.length, 2);
});

test('session reset discards pending telemetry snapshots and flushes only the current journal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime, provider } = fixture();
  t.after(() => runtime.dispose());
  const captures: Array<Record<string, unknown>> = [];
  const sessions: Array<Record<string, unknown>> = [];
  const telemetry = installVacpRuntimeAnalytics({
    bridge: runtime,
    options: { captureSnapshots: true, snapshotCaptureIntervalMs: 1000, sessionFlushIntervalMs: 50 },
    provider: {
      name: 'test',
      capture: (_event, props) => captures.push(props ?? {}),
      setSessionProperties: (props) => sessions.push(props),
    },
  });
  t.after(() => telemetry.cleanup());
  await runtime.refresh({ message: 'old-first' });
  await runtime.refresh({ message: 'old-pending' });
  runtime.update({ providers: [provider], sessionKey: 'new' });
  await runtime.refresh({ message: 'new-session' });
  t.mock.timers.tick(1000);
  // The pending snapshot of the previous session is dropped; delivered ones keep their order.
  const observed = new Set(['old-first', 'old-pending', 'new-session']);
  assert.deepEqual(
    captures.flatMap(({ message }) => (observed.has(message as string) ? [message] : [])),
    ['old-first', 'new-session'],
  );
  const latest = sessions.at(-1)!;
  assert.equal(latest.vacp_session_key, 'new');
  const history = latest.vacp_history as { kind: string; message?: string }[];
  assert.deepEqual(
    history.map((entry) => entry.kind),
    ['session', 'observation'],
  );
  assert.equal(history.at(-1)!.message, 'new-session');
});
