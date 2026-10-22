import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { vacpHumanActor, type VacpProvenanceRecord, type VacpRef } from '@ethivia/vacp-protocol';
import {
  createVacpProvider,
  createVacpRestorer,
  createVacpRuntime,
  registerVacpApplyStateAction,
  VacpActionRegistry,
} from '@ethivia/vacp-runtime';
import { provenanceAttribution } from '../src/index';

const filter: VacpRef = 'vacp://settings/filter';
const limit: VacpRef = 'vacp://settings/limit';
const clocks = { frozen: 0, advancing: 1000, backward: -1 } as const;

function fixture(t: TestContext, ms: number, historyLimit?: number) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  const step = () => t.mock.timers.setTime(Date.now() + ms);
  let value: unknown = 'all';
  let unreadable = false;
  let limitValue = 0;
  let invalidate = () => {};
  let restoring: (() => Promise<void>) | undefined;
  const during = new Map<unknown, () => Promise<void>>();
  const source = { id: 'vacp-source://settings' as const, type: 'test', title: 'Settings' };
  const actions = new VacpActionRegistry(source.id);
  const set = actions.register(
    { name: 'set', description: 'Set the filter', operation: { kind: 'mutation' } },
    async (next: unknown) => {
      value = next;
      await during.get(next)?.();
    },
  ).name;
  const read = actions.register(
    { name: 'read', description: 'Read the filter', operation: { kind: 'query' } },
    () => value,
  ).name;
  registerVacpApplyStateAction(actions, (state) => async () => {
    value = state[filter];
    await restoring?.();
  });
  const provider = createVacpProvider({
    source,
    actions,
    subscribe: (notify) => {
      invalidate = notify;
      return () => {};
    },
    project: () => {
      if (unreadable) throw new Error('Settings are unreadable');
      return {
        graph: {
          nodes: [filter, limit].map((ref) => ({ ref, kind: 'Param', layer: 'ConfigLayer' })),
          edges: [],
          actions: actions.list(),
        },
        state: { [filter]: value, [limit]: limitValue },
      };
    },
  });
  const runtime = createVacpRuntime({ providers: [provider], historyLimit });
  t.after(() => runtime.dispose());
  t.after(runtime.subscribeProvenance(() => {}));
  return {
    runtime,
    step,
    edit: (next: unknown) => {
      value = next;
    },
    failReads: (fail: boolean) => {
      unreadable = fail;
    },
    person: async (next: unknown) => {
      value = next;
      await runtime.refresh({ actor: vacpHumanActor });
      return runtime.getProvenance().records.at(-1)!;
    },
    set: async (next: unknown, body?: () => Promise<void>) => {
      if (body) during.set(next, body);
      try {
        assert((await runtime.execute({ name: set, params: next })).ok);
      } finally {
        during.delete(next);
      }
    },
    read: () => runtime.execute({ name: read }),
    restore: async (next: unknown, body?: () => Promise<void>) => {
      restoring = body;
      try {
        assert((await createVacpRestorer(runtime).restore({ [filter]: next })).ok);
      } finally {
        restoring = undefined;
      }
    },
    capture: async (next: unknown) => {
      // The other ref forces a record when the filter repeats the last recorded value.
      limitValue++;
      value = next;
      step();
      const observed = new Promise<VacpProvenanceRecord>((resolve) => {
        const detach = runtime.subscribeProvenance(({ record }) => {
          if (record?.kind === 'observation' && record.cause.kind === 'concurrent') {
            detach();
            resolve(record);
          }
        });
        t.after(detach);
      });
      invalidate();
      const record = await observed;
      assert(record.kind === 'observation');
      assert.equal(record.observation.state[filter], next);
      return record;
    },
    expect: (expected: VacpProvenanceRecord | 'unknown') => {
      const journal = runtime.getProvenance();
      const serialized: typeof journal = JSON.parse(JSON.stringify(journal));
      for (const captured of [journal, serialized]) {
        const origin = provenanceAttribution(captured, filter);
        if (typeof expected === 'string') assert.equal(origin, expected);
        else {
          assert(typeof origin !== 'string');
          assert.equal(origin.id, expected.id);
        }
      }
    },
  };
}

for (const [clock, ms] of Object.entries(clocks)) {
  for (const transient of [false, true])
    test(`restoration ${transient ? 'keeps a transient concurrent value unknown' : 'preserves an earlier owner when the concurrent capture matches the result'} with a ${clock} clock`, async (t) => {
      const f = fixture(t, ms);
      await f.runtime.refresh();
      const human = await f.person('hidden');
      await f.set('open');
      f.step();
      await f.set(transient ? 'hidden' : 'closed', async () => {
        await f.capture(transient ? 'hidden' : 'closed');
        f.expect('unknown');
        f.step();
        f.edit('closed');
      });
      const terminal = f.runtime.getProvenance().records.at(-1);
      assert(terminal?.kind === 'action');
      assert.deepEqual([terminal.before?.state[filter], terminal.observation?.state[filter]], ['open', 'closed']);
      f.expect(terminal);
      f.step();
      await f.restore('hidden');
      f.expect(transient ? 'unknown' : human);
    });

  test(`a transient equal to the current value retains unknown ownership with a ${clock} clock`, async (t) => {
    const f = fixture(t, ms);
    await f.runtime.refresh();
    await f.person('hidden');
    f.edit('open');
    await f.set('hidden', async () => {
      await f.capture('hidden');
      f.edit('closed');
    });
    const terminal = f.runtime.getProvenance().records.at(-1);
    assert(terminal?.kind === 'action');
    assert.deepEqual([terminal.before?.state[filter], terminal.observation?.state[filter]], ['open', 'closed']);
    await f.restore('hidden');
    f.expect('unknown');
  });

  test(`a concurrent capture matching a later before preserves its earlier owner with a ${clock} clock`, async (t) => {
    const f = fixture(t, ms);
    await f.runtime.refresh();
    const human = await f.person('hidden');
    await f.set('hidden', async () => {
      await f.capture('hidden');
      f.edit('closed');
    });
    const terminal = f.runtime.getProvenance().records.at(-1);
    assert(terminal?.kind === 'action');
    assert.deepEqual([terminal.before?.state[filter], terminal.observation?.state[filter]], ['hidden', 'closed']);
    await f.restore('hidden');
    f.expect(human);
  });

  test(`successive transient captures remain unknown when restored with a ${clock} clock`, async (t) => {
    const f = fixture(t, ms);
    await f.runtime.refresh();
    await f.person('hidden');
    await f.person('pending');
    await f.set('open');
    await f.set('hidden', async () => {
      await f.capture('hidden');
      await f.capture('pending');
      await f.capture('hidden');
      f.edit('closed');
    });
    for (const value of ['pending', 'hidden']) {
      await f.restore(value);
      f.expect('unknown');
    }
  });

  test(`a concurrent value captured through a query restores as unknown with a ${clock} clock`, async (t) => {
    const f = fixture(t, ms);
    await f.runtime.refresh();
    await f.person('hidden');
    await f.set('open');
    await f.set('hidden', async () => {
      assert((await f.read()).ok);
      f.expect('unknown');
      f.step();
      f.edit('closed');
    });
    await f.restore('hidden');
    f.expect('unknown');
  });
}

for (const [clock, ms] of Object.entries(clocks)) {
  for (const accounted of [false, true])
    test(`multiple listed executions keep ${accounted ? 'independent before captures' : 'a transient capture'} unknown with a ${clock} clock`, async (t) => {
      const f = fixture(t, ms);
      await f.runtime.refresh();
      await f.person('hidden');
      await f.set('open');
      let captured!: VacpProvenanceRecord;
      await f.set(accounted ? 'hidden' : 'pending', async () => {
        await f.set('ready', async () => {
          captured = await f.capture('hidden');
          f.edit('closed');
        });
      });
      assert(captured.kind === 'observation' && captured.cause.kind === 'concurrent');
      assert.equal(captured.cause.executions.length, 2);
      const records = f.runtime.getProvenance().records.slice(-2);
      assert.deepEqual(
        records.map(
          (record) => record.kind === 'action' && [record.before?.state[filter], record.observation?.state[filter]],
        ),
        [
          [accounted ? 'hidden' : 'pending', 'closed'],
          ['open', 'closed'],
        ],
      );
      await f.restore('hidden');
      f.expect('unknown');
    });

  test(`a concurrent transient with a missing terminal result restores as unknown with a ${clock} clock`, async (t) => {
    const f = fixture(t, ms);
    await f.runtime.refresh();
    await f.person('hidden');
    await f.set('open');
    await f.set('hidden', async () => {
      await f.capture('hidden');
      f.edit('closed');
      f.failReads(true);
    });
    const terminal = f.runtime.getProvenance().records.at(-1);
    assert(terminal?.kind === 'action');
    assert.equal(terminal.before?.state[filter], 'open');
    assert.equal(terminal.observation, undefined);
    f.expect('unknown');
    f.failReads(false);
    await f.restore('hidden');
    f.expect('unknown');
  });

  for (const historyLimit of [2, 3])
    test(`a transient remains unknown with its observation ${historyLimit === 2 ? 'dropped' : 'retained'} and a ${clock} clock`, async (t) => {
      const f = fixture(t, ms, historyLimit);
      await f.runtime.refresh();
      await f.person('hidden');
      await f.set('open');
      await f.set('pending', async () => {
        await f.set('ready', async () => {
          const concurrent = await f.capture('hidden');
          assert(concurrent.kind === 'observation' && concurrent.cause.kind === 'concurrent');
          assert.equal(concurrent.cause.executions.length, 2);
          f.edit('closed');
        });
      });
      const journal = f.runtime.getProvenance();
      assert.equal(
        journal.records.some((record) => record.kind === 'observation'),
        historyLimit === 3,
      );
      assert.equal(journal.revision > journal.records.length, true);
      await f.restore('hidden');
      f.expect('unknown');
    });

  for (const transient of [false, true])
    test(`a restoration body ${transient ? 'keeps a transient capture unknown' : 'preserves an accounted value owner'} with a ${clock} clock`, async (t) => {
      const f = fixture(t, ms);
      await f.runtime.refresh();
      const human = await f.person('hidden');
      await f.set('open');
      await f.restore(transient ? 'hidden' : 'closed', async () => {
        await f.capture(transient ? 'hidden' : 'closed');
        f.edit('closed');
      });
      const terminal = f.runtime.getProvenance().records.at(-1);
      assert(terminal?.kind === 'action' && terminal.execution.restoration);
      assert.deepEqual([terminal.before?.state[filter], terminal.observation?.state[filter]], ['open', 'closed']);
      f.expect(terminal);
      await f.restore('hidden');
      f.expect(transient ? 'unknown' : human);
    });
}
