import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpExecution } from '@vacp/protocol';
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
    subscribe: () => () => {},
    source: { id: 'vacp-source://test', type: 'test', title: 'Test' },
    actions,
    project: () => ({
      graph: {
        nodes: [{ ref: 'vacp://plot', kind: 'View', layer: 'ViewLayer' }],
        edges: [],
        actions: actions.list(),
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
    const last = f.runtime.getProvenance().records.at(-1)!;
    assert.ok(last.kind === 'action');
    assert.equal(last.result.ok, false);
    assert.equal(last.before, undefined);
    assert.deepEqual(last.observation?.state, { 'vacp://plot': 14 });
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

test('prepared execution observes cancellation from either context and preserves its reason', async () => {
  for (const mode of ['preparation', 'execution', 'shared', 'both-preparation', 'both-execution'] as const) {
    const preparation = new AbortController();
    const execution = mode === 'shared' ? preparation : new AbortController();
    const reason = new Error(mode);
    const actions = new VacpActionRegistry();
    actions.register(
      { name: 'cancel', description: 'Cancel during execution', operation: { kind: 'query' } },
      (_params, { signal }) => {
        assert.ok(signal);
        const cancelled = mode === 'execution' || mode === 'both-execution' ? execution : preparation;
        cancelled.abort(reason);
        assert.equal(signal.aborted, true, mode);
        return 'finished';
      },
    );
    const prepared = await actions.prepare(
      { callId: mode, name: 'cancel' },
      mode === 'execution' ? {} : { signal: preparation.signal },
    );
    await assert.rejects(
      prepared.execute(mode === 'preparation' ? {} : { signal: execution.signal }),
      (error) => error === reason,
    );
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
    f.runtime.update({ providers: [] });
    await assert.rejects(pending, /abort/i);
    assert.equal(lease.signal.aborted, true);
    assert.equal(f.events.at(-1)!.phase, 'cancelled');
    assert.equal(f.counts().executed, 1);
  } finally {
    f.runtime.dispose();
  }
});

test('a stalled presentation gate releases execution at its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let gateSignal: AbortSignal | undefined;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    f.runtime.addExecutionGate(
      (_event, signal) => {
        gateSignal = signal;
        entered();
        return new Promise(() => {});
      },
      { timeoutMs: 50 },
    );
    const result = f.runtime.execute({ callId: 'bounded', name: 'set', params: 1 });
    await waiting;
    t.mock.timers.tick(50);
    assert.equal((await result).ok, true);
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
    assert.equal(
      f.runtime
        .getProvenance()
        .records.filter((record) => record.kind === 'action')
        .at(-1)!.result.ok,
      true,
    );
    assert.equal(f.events.at(-1)!.phase, 'succeeded');
  } finally {
    f.runtime.dispose();
  }
});

test('before checkpoint is captured after pacing and includes intervening human changes', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const release = f.runtime.addExecutionGate(
    async () => {
      const prepared = await f.provider.prepare({ callId: 'human-edit', name: 'set', params: 9 });
      await prepared.execute();
      await f.runtime.refresh({ actor: { id: 'person', kind: 'human' } });
    },
    { timeoutMs: 1000 },
  );
  await f.runtime.execute({ callId: 'agent-edit', name: 'set', params: 2 });
  release();
  const records = f.runtime.getProvenance().records;
  const action = records.find((record) => record.kind === 'action');
  assert.ok(action?.kind === 'action');
  assert.equal(action.before?.state['vacp://plot'], 18);
  assert.equal(action.observation?.state['vacp://plot'], 4);
  assert.ok(records.some((record) => record.kind === 'observation' && record.actor.kind === 'human'));
});

test('abort during post-action observation preserves one successful outcome and one record', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const abort = new AbortController();
  f.runtime.subscribeExecutions((event) => {
    if (event.phase === 'succeeded') abort.abort(new Error('Stopped viewing'));
  });
  const result = await f.runtime.execute(
    { callId: 'completed-before-abort', name: 'set', params: 3 },
    { signal: abort.signal },
  );
  assert.equal(result.ok, true);
  const records = f.runtime.getProvenance().records.filter((record) => record.kind === 'action');
  assert.equal(records.length, 1);
  assert.equal(records[0]!.result.ok, true);
  assert.equal(records[0]!.execution.phase, 'succeeded');
  assert.equal(f.events.filter((event) => ['succeeded', 'failed', 'cancelled'].includes(event.phase)).length, 1);
});

test('failed post-action observation preserves the successful result without inventing freshness', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  f.runtime.subscribeExecutions((event) => {
    if (event.phase === 'succeeded')
      f.provider.observe = async () => {
        throw new Error('Cannot read output');
      };
  });
  const result = await f.runtime.execute({ callId: 'unreadable', name: 'set', params: 3 });
  assert.equal(result.ok, true);
  const records = f.runtime.getProvenance().records.filter((record) => record.kind === 'action');
  assert.equal(records.length, 1);
  assert.equal(records[0]!.execution.phase, 'succeeded');
  assert.equal(records[0]!.observation, undefined);
});

test('an uncloneable post-action state is unavailable evidence, not a failed completed action', async (t) => {
  let value: unknown = 0;
  const actions = new VacpActionRegistry();
  actions.register(
    { name: 'callback-state', description: 'Set callback state', operation: { kind: 'mutation' } },
    () => {
      value = { threshold: 2, callback: () => 'native-only' };
      return 'applied';
    },
  );
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://capture-state', type: 'test', title: 'Capture state' },
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
  const phases: string[] = [];
  runtime.subscribeExecutions((event) => phases.push(event.phase));
  const result = await runtime.execute({ callId: 'capture-state', name: 'callback-state' });
  assert.deepEqual(result, { callId: 'capture-state', ok: true, result: 'applied' });
  const records = runtime.getProvenance().records;
  assert.equal(records.length, 1);
  const record = records[0]!;
  assert.ok(record.kind === 'action');
  assert.equal(record.execution.phase, 'succeeded');
  assert.deepEqual(record.result, result);
  assert.equal(record.before?.state['vacp://value'], 0);
  assert.equal(record.observation, undefined);
  assert.deepEqual(phases, ['accepted', 'prepared', 'running', 'succeeded']);
});
