import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacpRuntime, createVacpProvider, VacpActionRegistry } from '../src/index';

test('bounded provenance preserves the host actor, public summary, and isolated complete observations', async (t) => {
  const value = { threshold: 0 };
  const actions = new VacpActionRegistry();
  actions.register(
    { name: 'set', title: 'Change threshold', description: 'Set', operation: { kind: 'mutation' } },
    (next) => {
      value.threshold = Number(next);
    },
  );
  const runtime = createVacpRuntime({
    historyLimit: 3,
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://history', title: 'History', type: 'test' },
        actions,
        project: () => ({
          graph: {
            nodes: [{ ref: 'vacp://value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: actions.list(),
          },
          state: { 'vacp://value': value },
        }),
      }),
    ],
  });
  t.after(() => runtime.dispose());
  const actor = { id: 'researcher', label: 'Research assistant', kind: 'agent' as const };
  const work = runtime.beginAgentActivity({ actor, summary: 'Checking a narrower threshold' });
  await runtime.execute({ name: 'set', params: 1 }, { actor });
  const recorded = runtime.getProvenance().records[0]!;
  assert.ok(recorded.kind === 'action');
  assert.deepEqual(recorded.execution.actor, actor);
  assert.equal(recorded.execution.narration, 'Checking a narrower threshold');
  assert.equal(recorded.execution?.phase, 'succeeded');
  assert.deepEqual(recorded.before?.state['vacp://value'], { threshold: 0 });
  assert.deepEqual(recorded.observation?.state['vacp://value'], { threshold: 1 });
  work.end();
  await runtime.execute({ name: 'set', params: 2 }, { actor: { id: 'person', kind: 'human' } });
  await runtime.execute({ name: 'set', params: 3 });
  await runtime.execute({ name: 'set', params: 4 });
  const entries = runtime.getProvenance().records.filter((entry) => entry.kind === 'action');
  assert.equal(entries.length, 3);
  assert.equal(entries[0]!.execution.actor.kind, 'human');
  assert.deepEqual(recorded.observation?.state['vacp://value'], { threshold: 1 });
  assert.throws(() => {
    entries[0]!.execution.actor.id = 'tampered';
  }, TypeError);
  assert.equal(
    runtime.getProvenance().records.filter((entry) => entry.kind === 'action')[0]!.execution.actor.id,
    'person',
  );
});

test('provenance revision counts dropped records within an epoch', async (t) => {
  const actions = new VacpActionRegistry();
  actions.register({ name: 'set', description: 'Set', operation: { kind: 'mutation' } }, () => {});
  const runtime = createVacpRuntime({
    historyLimit: 3,
    sessionKey: 'first',
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://retention', title: 'Retention', type: 'test' },
        actions,
        project: () => ({ graph: { nodes: [], edges: [], actions: actions.list() }, state: {} }),
      }),
    ],
  });
  t.after(() => runtime.dispose());
  for (const callId of ['a', 'b', 'c', 'd', 'e']) await runtime.execute({ callId, name: 'set' });
  const full = runtime.getProvenance();
  assert.deepEqual(
    full.records.map((entry) => entry.kind === 'action' && entry.call.callId),
    ['c', 'd', 'e'],
  );
  assert.equal(full.revision, 5);
  assert.equal(full.revision - full.records.length, 2);

  runtime.update({ providers: [], sessionKey: 'second' });
  const next = runtime.getProvenance();
  assert.equal(next.epoch, full.epoch + 1);
  assert.deepEqual(
    next.records.map((entry) => entry.kind),
    ['session'],
  );
  assert.equal(next.revision, 1);
});

test('provenance reads are passive and session epochs reset retention with isolated events', async (t) => {
  const runtime = createVacpRuntime({ providers: [], sessionKey: 'first' });
  t.after(() => runtime.dispose());
  const revisions: Array<[number, number, string | null]> = [];
  runtime.subscribeProvenance((event) => {
    revisions.push([event.epoch, event.revision, event.record?.kind ?? null]);
    if (event.record) event.record.message = 'tampered';
  });
  await runtime.refresh({ message: 'first checkpoint' });
  const snapshot = runtime.getProvenance();
  assert.equal(snapshot.records[0]!.message, 'first checkpoint');
  assert.deepEqual(runtime.getProvenance(), snapshot);
  assert.equal(revisions.length, 1);
  runtime.update({ providers: [], sessionKey: 'second' });
  assert.deepEqual(revisions.slice(1, 3), [
    [1, 0, null],
    [1, 1, 'session'],
  ]);
  assert.equal(runtime.getProvenance().sessionKey, 'second');
  assert.deepEqual(
    runtime.getProvenance().records.map((entry) => entry.kind),
    ['session'],
  );
});

test('invalid provenance retention is rejected before acquiring provider subscriptions', () => {
  let subscriptions = 0;
  const provider = createVacpProvider({
    source: { id: 'vacp-source://validation', type: 'test', title: 'Validation' },
    actions: new VacpActionRegistry(),
    project: () => ({ graph: { nodes: [], edges: [], actions: [] }, state: {} }),
    subscribe: () => {
      subscriptions++;
      return () => {
        subscriptions--;
      };
    },
  });
  assert.throws(() => createVacpRuntime({ providers: [provider], historyLimit: NaN }), /historyLimit/);
  assert.equal(subscriptions, 0);
});

test('concurrent observations retain unknown causality while explicit human changes stay external', async (t) => {
  let value = 0;
  let started!: () => void;
  let finish!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let invalidate = () => {};
  const actions = new VacpActionRegistry();
  actions.register({ name: 'slow', description: 'Slow change', operation: { kind: 'mutation' } }, async () => {
    value = 1;
    invalidate();
    started();
    await blocked;
    value = 4;
  });
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        subscribe: (listener) => {
          invalidate = listener;
          return () => {};
        },
        source: { id: 'vacp-source://concurrent', title: 'Concurrent', type: 'test' },
        actions,
        project: () => ({
          graph: {
            nodes: [{ ref: 'vacp://value', kind: 'Param', layer: 'ConfigLayer' }],
            edges: [],
            actions: actions.list(),
          },
          state: { 'vacp://value': value },
        }),
      }),
    ],
  });
  t.after(() => {
    finish();
    runtime.dispose();
  });
  let observed = () => {};
  runtime.subscribeProvenance(({ record }) => {
    if (record?.kind === 'observation') observed();
  });
  const nextObservation = () =>
    new Promise<void>((resolve) => {
      observed = resolve;
    });
  await runtime.refresh();
  const recordedStep = nextObservation();
  const pending = runtime.execute({ name: 'slow' }, { restoration: { id: 'review', entryId: 'step' } });
  await began;
  const active = runtime.getActiveExecutions();
  assert.equal(active.length, 1);
  assert.equal(active[0]!.phase, 'running');
  active[0]!.actor.id = 'tampered';
  assert.equal(runtime.getActiveExecutions()[0]!.actor.id, 'agent');
  await recordedStep;
  const recordedChange = nextObservation();
  value = 2;
  invalidate();
  await recordedChange;
  value = 3;
  await runtime.refresh({ actor: { id: 'person', kind: 'human' }, message: 'Manual change during operation' });
  const records = runtime.getProvenance().records.filter((record) => record.kind === 'observation');
  assert.deepEqual(
    records.map((record) => [record.observation.state['vacp://value'], record.cause.kind]),
    [
      [0, 'external'],
      [1, 'concurrent'],
      [2, 'concurrent'],
      [3, 'external'],
    ],
  );
  const concurrent = records[1]!.cause;
  assert.ok(concurrent.kind === 'concurrent');
  assert.deepEqual(concurrent.executions, [
    { executionId: active[0]!.id, restoration: { id: 'review', entryId: 'step' } },
  ]);
  finish();
  assert.equal((await pending).ok, true);
  assert.deepEqual(runtime.getActiveExecutions(), []);
  const action = runtime.getProvenance().records.find((record) => record.kind === 'action');
  assert.equal(action?.observation?.state['vacp://value'], 4);
});

test('uncapturable result payloads retain truthful provenance without changing the completed outcome', async (t) => {
  const payload = { value: 42, callback: () => 'still available to the caller' };
  const actions = new VacpActionRegistry();
  actions.register(
    { name: 'callback', description: 'Return callback', operation: { kind: 'mutation' } },
    () => payload,
  );
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://capture', title: 'Capture', type: 'test' },
        actions,
        project: () => ({ graph: { nodes: [], edges: [], actions: actions.list() }, state: {} }),
      }),
    ],
  });
  t.after(() => runtime.dispose());
  const result = await runtime.execute({ callId: 'callback', name: 'callback' });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected success');
  assert.equal(result.result, payload);
  assert.equal(payload.callback(), 'still available to the caller');
  const records = runtime.getProvenance().records;
  assert.equal(records.length, 1);
  const recorded = records[0]!;
  assert.ok(recorded.kind === 'action');
  assert.equal(recorded.execution.phase, 'succeeded');
  assert.deepEqual(recorded.result, { callId: 'callback', ok: true });
  assert.deepEqual(recorded.captureErrors, [
    { field: 'result', message: 'Result payload is not structured-cloneable' },
  ]);
});

test('mutable Date payloads are isolated between provenance subscribers and later readers', async (t) => {
  const runtime = createVacpRuntime({ providers: [] });
  t.after(() => runtime.dispose());
  const instant = new Date('2026-09-22T12:00:00.000Z');
  const received: number[] = [];
  runtime.subscribeProvenance(({ record }) => {
    if (record?.kind === 'observation' && record.focus?.detail instanceof Date) record.focus.detail.setTime(0);
  });
  runtime.subscribeProvenance(({ record }) => {
    if (record?.kind === 'observation' && record.focus?.detail instanceof Date)
      received.push(record.focus.detail.getTime());
  });
  await runtime.refresh({ focus: { ref: 'vacp://time', detail: instant } });
  const first = runtime.getProvenance().records[0]!;
  assert.ok(first.kind === 'observation');
  assert.ok(first.focus?.detail instanceof Date);
  first.focus.detail.setTime(1);
  instant.setTime(2);
  const next = runtime.getProvenance().records[0]!;
  assert.ok(next.kind === 'observation');
  assert.deepEqual(received, [Date.parse('2026-09-22T12:00:00.000Z')]);
  assert.ok(next.focus?.detail instanceof Date);
  assert.equal(next.focus.detail.toISOString(), '2026-09-22T12:00:00.000Z');
});
