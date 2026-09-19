import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION, type VacpExecution } from '@vacp/protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '../src/index';

function fixture() {
  const actions = new VacpActionRegistry();
  let parsed = 0,
    executed = 0,
    value = 0;
  actions.register(
    { name: 'set', description: 'Set value', operation: { kind: 'mutation', affects: ['vacp://plot'] } },
    (next: number) => {
      executed++;
      value = next;
      return value;
    },
    {
      parse: (input) => {
        parsed++;
        if (typeof input !== 'number') throw new Error('Expected number');
        return input * 2;
      },
      focus: (next) => ({ ref: 'vacp://plot', detail: next }),
    },
  );
  const provider = createVacpProvider({
    source: { id: 'vacp-source://test', type: 'test', title: 'Test' },
    actions,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: 'vacp://plot', kind: 'View', layer: 'ViewLayer' }],
        edges: [],
      },
      state: { 'vacp://plot': value },
    }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  const events: VacpExecution[] = [];
  runtime.subscribeExecutions((event) => events.push(event));
  return { runtime, provider, actions, events, counts: () => ({ parsed, executed, value }) };
}

test('preparation normalizes once, focus sees the executed value, and actor identity is host-owned', async () => {
  const f = fixture();
  try {
    f.runtime.subscribeExecutions(() => {
      throw new Error('broken observer');
    });
    assert.equal(
      (await f.runtime.execute({ callId: 'same', name: 'set', params: 7 }, { actor: { id: 'analyst', kind: 'agent' } }))
        .ok,
      true,
    );
    assert.deepEqual(
      f.events.map((event) => event.phase),
      ['accepted', 'prepared', 'running', 'succeeded'],
    );
    assert.deepEqual(f.events[1]!.intent, { affects: ['vacp://plot'], focus: { ref: 'vacp://plot', detail: 14 } });
    assert.deepEqual(f.counts(), { parsed: 1, executed: 1, value: 14 });
    assert.equal(f.events[3]!.actor.id, 'analyst');
    await f.runtime.execute({ callId: 'same', name: 'set', params: 'bad' });
    assert.deepEqual(
      f.events.slice(4).map((event) => event.phase),
      ['accepted', 'failed'],
    );
    assert.notEqual(f.events[0]!.id, f.events[4]!.id);
    assert.deepEqual(f.counts(), { parsed: 2, executed: 1, value: 14 });
    const last = (await f.runtime.getRuntime()).history.at(-1)!;
    assert.equal(last.result?.ok, false);
    assert.deepEqual(last.afterState?.state, last.beforeState?.state);
  } finally {
    f.runtime.dispose();
  }
});

test('a prepared operation is single use, including concurrent attempts', async () => {
  const f = fixture();
  try {
    const prepared = await f.provider.prepare({ callId: 'once', name: 'set', params: 3 });
    const results = await Promise.allSettled([prepared.execute(), prepared.execute()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(f.counts().executed, 1);
  } finally {
    f.runtime.dispose();
  }
});

test('presentation gates fail open, but provider replacement aborts prepared execution', async () => {
  const f = fixture();
  try {
    const broken = f.runtime.addExecutionGate(
      () => {
        throw new Error('renderer');
      },
      { timeoutMs: 10 },
    );
    await f.runtime.execute({ callId: 'visible', name: 'set', params: 1 });
    broken();
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.runtime.addExecutionGate(
      () => {
        release();
        return new Promise(() => {});
      },
      { timeoutMs: 1000 },
    );
    const lease = f.runtime.getProviderBinding(f.provider);
    const pending = f.runtime.execute({ callId: 'replaced', name: 'set', params: 2 });
    await entered;
    f.runtime.removeProvider(f.provider.source.id);
    await assert.rejects(pending, /abort/i);
    assert.equal(lease.signal.aborted, true);
    assert.equal(f.events.at(-1)!.phase, 'cancelled');
    assert.equal(f.counts().executed, 1);
  } finally {
    f.runtime.dispose();
  }
});

test('a stalled presentation gate releases execution at its deadline', async () => {
  const f = fixture();
  let gateSignal: AbortSignal | undefined;
  try {
    f.runtime.addExecutionGate(
      (_event, signal) => {
        gateSignal = signal;
        return new Promise(() => {});
      },
      { timeoutMs: 1 },
    );
    assert.equal((await f.runtime.execute({ callId: 'bounded', name: 'set', params: 1 })).ok, true);
    assert.equal(gateSignal?.aborted, true);
  } finally {
    f.runtime.dispose();
  }
});

test('removing a presentation gate releases its active wait without cancelling the operation', async () => {
  const f = fixture();
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    const remove = f.runtime.addExecutionGate(
      () => {
        entered();
        return new Promise(() => {});
      },
      { timeoutMs: 30_000 },
    );
    const result = f.runtime.execute({ callId: 'presentation-removed', name: 'set', params: 2 });
    await waiting;
    remove();
    assert.equal((await result).ok, true);
    assert.equal(f.counts().executed, 1);
  } finally {
    f.runtime.dispose();
  }
});

test('runtime disposal publishes one terminal cancellation even when a provider is still preparing', async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const prepared = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.actions.register({ name: 'slow', description: 'Slow preparation', operation: { kind: 'mutation' } }, () => 1, {
    parse: async (value) => {
      entered();
      await prepared;
      return value;
    },
  });
  const pending = f.runtime.execute({ callId: 'disposed', name: 'slow' });
  await started;
  f.runtime.dispose();
  release();
  await assert.rejects(pending, /abort/i);
  assert.deepEqual(
    f.events.map((event) => event.phase),
    ['accepted', 'cancelled'],
  );
});

test('cancellation during an after-execution wait preserves the completed result and history', async () => {
  const f = fixture();
  const abort = new AbortController();
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.runtime.addExecutionGate(
    () => {
      entered();
      return new Promise(() => {});
    },
    { timeoutMs: 30_000, stage: 'after' },
  );
  try {
    const result = f.runtime.execute({ callId: 'completed', name: 'set', params: 2 }, { signal: abort.signal });
    await waiting;
    abort.abort();
    assert.equal((await result).ok, true);
    assert.equal((await f.runtime.getRuntime()).history.at(-1)!.result?.ok, true);
    assert.equal(f.events.at(-1)!.phase, 'succeeded');
  } finally {
    f.runtime.dispose();
  }
});
