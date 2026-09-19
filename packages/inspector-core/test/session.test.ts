import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { VacpObservation } from '@vacp/protocol';
import { createInspectorSession, type InspectorClient } from '../src/index';
import { client, deferred, observation, whenState } from './fixtures';

test('custom surfaces share a source while retaining independent observation histories', async () => {
  const source = client();
  const left = createInspectorSession(source, { historyLimit: 2 });
  const right = createInspectorSession(source);
  try {
    await Promise.all([left.refresh(), right.refresh()]);
    const first = left.getState().records[0];
    const result = await left.execute({ callId: 'edit', name: 'set', params: 2 });
    assert.deepEqual(result, { callId: 'edit', ok: true, result: 2 });
    assert.equal(right.getState().observation?.revision, '0');
    assert.equal(first.observation.state['vacp://value'], 0);
    assert.equal(source.calls, 1);
    await right.refresh();
    assert.equal(right.getState().observation?.revision, '2');
    assert.deepEqual(right.getState().records, []);
    await left.restore(first.observation);
    assert.equal(source.value, 0);
    assert.equal(left.getState().records.length, 2);
    left.clearHistory();
    assert.deepEqual(left.getState().records, []);
    assert.equal(first.observation.revision, '0');
  } finally {
    left.dispose();
    right.dispose();
  }
});

test('journals retain changed revisions within their limit', async () => {
  const value = observation();
  const source = client();
  source.observe = async () => value;
  const session = createInspectorSession(source, { historyLimit: 1 });
  try {
    await session.refresh();
    const firstId = session.getState().records[0].id;
    await session.refresh();
    assert.deepEqual(
      session.getState().records.map((record) => record.id),
      [firstId],
    );
    value.state['vacp://value'] = 99;
    value.revision = 'new';
    await session.refresh();
    assert.equal(session.getState().records.length, 1);
    assert.equal(session.getState().records[0].observation.revision, 'new');
    assert.equal(session.getState().records[0].observation.state['vacp://value'], 99);
  } finally {
    session.dispose();
  }
});

test('superseded and disposed reads settle even when the source ignores cancellation', async () => {
  const reads = Array.from({ length: 3 }, () => ({ entered: deferred<void>(), result: deferred<VacpObservation>() }));
  let index = 0;
  const source: InspectorClient = {
    id: 'test',
    title: 'Test',
    observe: () => {
      const read = reads[index++];
      read.entered.resolve();
      return read.result.promise;
    },
  };
  const session = createInspectorSession(source);
  const first = session.refresh();
  await reads[0].entered.promise;
  const second = session.refresh();
  await reads[1].entered.promise;
  reads[1].result.resolve(observation(2));
  await Promise.all([first, second]);
  reads[0].result.resolve(observation(1));
  // Drain the ignored source completion before asserting that no late state was published.
  await setImmediate();
  assert.equal(session.getState().observation?.revision, '2');
  const third = session.refresh();
  await reads[2].entered.promise;
  session.dispose();
  await third;
  reads[2].result.resolve(observation(3));
  await setImmediate();
  assert.equal(session.getState().status, 'disposed');
  assert.equal(session.getState().observation?.revision, '2');
});

test('subscriptions are inert, start is idempotent, and disposal releases the connection once', async () => {
  let connected = 0,
    released = 0,
    reads = 0,
    notifications = 0;
  const source = client();
  source.observe = async () => {
    reads++;
    return observation();
  };
  source.subscribe = () => {
    connected++;
    return () => released++;
  };
  const session = createInspectorSession(source);
  const listener = () => {
    notifications++;
  };
  const detachFirst = session.subscribe(listener);
  const detachSecond = session.subscribe(listener);
  assert.equal(reads, 0);
  session.start();
  session.start();
  await whenState(session, (state) => state.status === 'ready');
  assert.equal(connected, 1);
  assert.equal(reads, 1);
  detachFirst();
  const before = notifications;
  await session.refresh();
  assert.ok(notifications > before);
  detachSecond();
  session.dispose();
  session.dispose();
  assert.equal(released, 1);
  assert.equal((await source.observe({ signal: new AbortController().signal })).revision, '0');
  assert.throws(() => session.start(), /abort/i);
});

test('bursts of invalidations coalesce and a change during a read triggers one follow-up', async () => {
  let invalidate = () => {};
  const first = deferred<VacpObservation>();
  const entered = deferred<void>();
  let reads = 0;
  const source = client();
  source.subscribe = (notify) => {
    invalidate = notify;
    return () => {};
  };
  source.observe = () => {
    reads++;
    entered.resolve();
    return reads === 1 ? first.promise : Promise.resolve(observation(reads));
  };
  const session = createInspectorSession(source);
  session.start();
  await entered.promise;
  invalidate();
  invalidate();
  assert.equal(reads, 1);
  first.resolve(observation(1));
  await whenState(session, (state) => state.observation?.revision === '2');
  assert.equal(reads, 2);
  assert.equal(session.getState().observation?.revision, '2');
  session.dispose();
  invalidate();
  await setImmediate();
  assert.equal(reads, 2);
});

test('operation failure and observation failure retain independent diagnostics', async () => {
  const source = client();
  const session = createInspectorSession(source);
  await session.refresh();
  source.execute = async (call) => ({ callId: call.callId, ok: false, error: { message: 'Rejected input' } });
  source.observe = async () => {
    throw new Error('Offline');
  };
  const result = await session.execute({ callId: 'bad', name: 'set' });
  await whenState(session, (state) => state.status === 'error');
  assert.equal(result.ok, false);
  assert.equal(session.getState().observationError?.message, 'Offline');
  const operation = session.getState().operation;
  assert.equal(operation.status, 'complete');
  if (operation.status === 'complete') assert.deepEqual(operation.result, result);
  assert.equal(session.getState().observation?.revision, '0');
  session.dispose();
});

test('read-only clients expose observations and reject unavailable capabilities', async () => {
  const session = createInspectorSession({ id: 'archive', title: 'Archive', observe: async () => observation() });
  await session.refresh();
  await assert.rejects(session.execute({ callId: 'set', name: 'set' }), /support execution/);
  await assert.rejects(session.restore(observation()), /support restoration/);
  await assert.rejects(session.reveal('vacp://value'), /support reveal/);
  session.dispose();
});

test('cancelling execution releases the operation slot and ignores its late result', async () => {
  const source = client();
  const session = createInspectorSession(source);
  await session.refresh();
  const waiting = deferred<Awaited<ReturnType<NonNullable<typeof source.execute>>>>();
  const entered = deferred<void>();
  source.execute = () => {
    entered.resolve();
    return waiting.promise;
  };
  const abort = new AbortController();
  const pending = session.execute({ callId: 'slow', name: 'set' }, { signal: abort.signal });
  await entered.promise;
  await assert.rejects(session.execute({ callId: 'other', name: 'set' }), /already running/);
  abort.abort();
  await assert.rejects(pending, /abort/i);
  source.execute = async (call) => ({ callId: call.callId, ok: true, result: 42 });
  await session.execute({ callId: 'next', name: 'set' });
  waiting.resolve({ callId: 'slow', ok: true, result: 0 });
  await setImmediate();
  const state = session.getState().operation;
  assert.equal(state.status, 'complete');
  if (state.status === 'complete') assert.equal(state.result.callId, 'next');
  session.dispose();
});

test('execution settles independently of a pending observation and consumer failures', async () => {
  const source = client();
  const session = createInspectorSession(source);
  await session.refresh();
  source.observe = () => new Promise(() => {});
  session.subscribe(() => {
    throw new Error('Renderer failed');
  });
  let notifications = 0;
  session.subscribe(() => notifications++);
  const result = await session.execute({ callId: 'update', name: 'set', params: 7 });
  assert.equal(result.ok, true);
  assert.equal(source.value, 7);
  assert.equal(session.getState().operation.status, 'complete');
  assert.ok(notifications > 0);
  session.dispose();
  assert.equal(session.getState().status, 'disposed');
});

test('captured dates and open JSON payloads retain value semantics and source isolation', async () => {
  const at = new Date('2026-09-18T12:00:00Z');
  const value = observation();
  const payload = {
    ...JSON.parse('{"__proto__":{"safe":true},"constructor":"custom"}'),
    at,
    invalid: new Date(NaN),
    nested: [{ domain: [1, 2] }],
    unset: undefined,
  };
  value.state['vacp://value'] = payload;
  const source: InspectorClient<{ at: Date }, Date> = {
    id: 'dates',
    title: 'Dates',
    observe: async () => value,
    execute: async (call) => {
      assert.ok(call.params?.at instanceof Date);
      return { callId: call.callId, ok: true, result: call.params!.at };
    },
  };
  const session = createInspectorSession(source, { historyLimit: 1 });
  await session.refresh();
  const captured = session.getState().observation!.state['vacp://value'];
  const expected = { ...payload, at: at.toISOString(), invalid: null, nested: [{ domain: [1, 2] }] };
  assert.equal(Object.getPrototypeOf(captured), Object.prototype);
  assert.ok(Object.hasOwn(captured as object, '__proto__'));
  assert.ok(Object.isFrozen(captured));
  const result = await session.execute({ callId: 'date', name: 'set', params: { at } });
  assert.ok(result.ok && result.result instanceof Date);
  const operation = session.getState().operation;
  assert.equal(operation.status, 'complete');
  if (operation.status === 'complete' && operation.result.ok) assert.equal(operation.result.result, at.toISOString());
  at.setFullYear(2000);
  payload.nested[0].domain.push(3);
  assert.deepEqual(captured, expected);
  const nested = (captured as { nested: { domain: number[] }[] }).nested;
  assert.throws(() => nested[0].domain.push(4), TypeError);
  assert.equal(session.getState().records[0].observation.state['vacp://value'], captured);
  session.dispose();
});

test('capture failures identify incompatible values without reporting a completed operation as failed', async () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const payload of [new Uint8Array([1]), cycle]) {
    const value = observation();
    value.state['vacp://value'] = payload;
    let calls = 0;
    const source: InspectorClient = {
      id: 'values',
      title: 'Values',
      observe: async () => value,
      execute: async (call) => {
        calls++;
        return { callId: call.callId, ok: true, result: payload };
      },
    };
    const session = createInspectorSession(source);
    await session.refresh();
    assert.equal(session.getState().status, 'error');
    assert.match(session.getState().observationError!.message, /Cannot capture \$.state.vacp:\/\/value/);
    value.state['vacp://value'] = 1;
    await session.refresh();
    await assert.rejects(
      session.execute({ callId: 'input', name: 'set', params: payload }),
      /Cannot capture \$.params/,
    );
    assert.equal(calls, 0);
    const result = await session.execute({ callId: 'output', name: 'set' });
    assert.ok(result.ok);
    assert.deepEqual(result.result, payload);
    assert.equal(calls, 1);
    const operation = session.getState().operation;
    assert.equal(operation.status, 'capture-error');
    if (operation.status === 'capture-error') assert.match(operation.error.message, /Cannot capture \$.result/);
    session.dispose();
  }
});

test('failed operations still refresh changes committed before the failure', async () => {
  const source = client();
  const session = createInspectorSession(source);
  try {
    await session.refresh();
    source.execute = async () => {
      source.value = 7;
      throw new Error('Partially applied');
    };
    await assert.rejects(session.execute({ callId: 'partial', name: 'set' }), /Partially applied/);
    await whenState(session, (state) => state.observation?.state['vacp://value'] === 7);
    assert.equal(session.getState().operation.status, 'error');
  } finally {
    session.dispose();
  }
});
