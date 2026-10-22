import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  provenanceActor,
  vacpAgentActor,
  vacpHumanActor,
  type VacpProvenanceRecord,
  type VacpRef,
  type VacpSourceId,
} from '@ethivia/vacp-protocol';
import {
  createVacpProvider,
  createVacpRestorer,
  createVacpRuntime,
  registerVacpApplyStateAction,
  VacpActionRegistry,
} from '@ethivia/vacp-runtime';
import { createProvenanceReplay, provenanceAttribution } from '../src/index';

const filter: VacpRef = 'vacp://settings/filter';
const limit: VacpRef = 'vacp://settings/limit';

/** One source per setting, so a restoration runs one `vacp.apply_state` action per source. */
function fixture(options: { historyLimit?: number } = {}) {
  const state: Record<VacpRef, unknown> = { [filter]: 'all', [limit]: 10 };
  const invalidations = new Set<() => void>();
  const names: Record<string, string> = {};
  let during: (() => Promise<void>) | undefined;
  let unreadable = false;
  const providers = [filter, limit].map((ref) => {
    const source = { id: `vacp-source://${ref.slice('vacp://'.length)}` as VacpSourceId, type: 'test', title: ref };
    const actions = new VacpActionRegistry(source.id);
    names[ref] = actions.register(
      { name: 'set', description: 'Set the setting', operation: { kind: 'mutation' } },
      async (value: unknown, { signal }) => {
        state[ref] = value;
        await during?.();
        signal?.throwIfAborted();
      },
    ).name;
    if (ref === filter) {
      names.reset = actions.register(
        { name: 'reset', description: 'Reset every setting', operation: { kind: 'mutation' } },
        () => {
          state[filter] = 'all';
          throw new Error('The limit is locked');
        },
      ).name;
      names.count = actions.register(
        { name: 'count', description: 'Count the settings', operation: { kind: 'query' } },
        async () => {
          await during?.();
          return Object.keys(state).length;
        },
      ).name;
    }
    registerVacpApplyStateAction(actions, (next) => async () => {
      Object.assign(state, next);
      await during?.();
    });
    return createVacpProvider({
      subscribe: (invalidate) => {
        invalidations.add(invalidate);
        return () => {
          invalidations.delete(invalidate);
        };
      },
      source,
      actions,
      project: () => {
        if (unreadable) throw new Error('The settings are unreadable');
        return {
          graph: { nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer' }], edges: [], actions: actions.list() },
          state: { [ref]: state[ref] },
        };
      },
    });
  });
  const runtime = createVacpRuntime({ providers, historyLimit: options.historyLimit });
  /** `meanwhile` runs inside the operation, after a `set` or a restoration applied its value and before it returns. */
  const run = async <Result>(operation: () => Promise<Result>, meanwhile?: () => Promise<void>) => {
    during = meanwhile;
    try {
      return await operation();
    } finally {
      during = undefined;
    }
  };
  return {
    runtime,
    providers,
    state,
    invalidate: () => invalidations.forEach((invalidate) => invalidate()),
    failReads: (fail: boolean) => {
      unreadable = fail;
    },
    agent: (ref: VacpRef, value: unknown, meanwhile?: () => Promise<void>, signal?: AbortSignal) =>
      run(
        () => runtime.execute({ callId: `set ${ref} ${String(value)}`, name: names[ref]!, params: value }, { signal }),
        meanwhile,
      ),
    reset: () => run(() => runtime.execute({ callId: 'reset', name: names.reset! })),
    count: (meanwhile?: () => Promise<void>) => run(() => runtime.execute({ name: names.count! }), meanwhile),
    restore: (values: Record<VacpRef, unknown>, meanwhile?: () => Promise<void>) =>
      run(() => createVacpRestorer(runtime).restore(values), meanwhile),
    person: async (ref: VacpRef, value: unknown) => {
      state[ref] = value;
      await runtime.refresh({ actor: vacpHumanActor, message: 'Changed a setting' });
    },
    origin: (ref: VacpRef) => provenanceAttribution(runtime.getProvenance(), ref),
  };
}

/** How far the host clock moves at each `step()`. Attribution gives the same answer for every clock. */
const clocks = { frozen: 0, advancing: 1000, 'running backwards': -1 } as const;

function clock(t: TestContext, ms: number) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  return () => t.mock.timers.setTime(Date.now() + ms);
}

function recorded(origin: VacpProvenanceRecord | 'unchanged' | 'unknown'): VacpProvenanceRecord {
  if (typeof origin === 'string') assert.fail(`expected a record, got ${origin}`);
  return origin;
}

function action(origin: VacpProvenanceRecord | 'unchanged' | 'unknown') {
  const record = recorded(origin);
  assert(record.kind === 'action', `expected an action, got ${record.kind}`);
  return record;
}

test('an agent action owns the value it set', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  f.runtime.narrate({ actor: vacpAgentActor, message: 'The filter is open.', done: true });
  assert.equal(f.runtime.getProvenance().records.at(-1)?.kind, 'turn');
  const origin = action(f.origin(filter));
  assert.equal(origin.call.callId, `set ${filter} open`);
  assert.equal(provenanceActor(origin).kind, 'agent');
});

test('a person’s reported change owns the value until another record changes it', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.person(limit, 20);
  await f.agent(filter, 'open');
  const origin = recorded(f.origin(limit));
  assert.equal(origin.kind, 'observation');
  assert.equal(provenanceActor(origin).kind, 'human');
  assert.equal(origin.message, 'Changed a setting');
  await f.agent(limit, 30);
  assert.equal(action(f.origin(limit)).call.callId, `set ${limit} 30`);
});

test('a ref no record changed is unchanged while the journal retains the whole session', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open');
  await f.count();
  assert.equal(f.origin(limit), 'unchanged');
});

test('a failed action owns the effects it applied before failing', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  assert.equal((await f.reset()).ok, false);
  const origin = action(f.origin(filter));
  assert.equal(origin.call.callId, 'reset');
  assert.equal(origin.execution.phase, 'failed');
});

test('a cancelled action owns the effects it applied before cancelling', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const controller = new AbortController();
  await assert.rejects(f.agent(filter, 'open', async () => controller.abort(), controller.signal));
  const origin = action(f.origin(filter));
  assert.equal(origin.call.callId, `set ${filter} open`);
  assert.equal(origin.execution.phase, 'cancelled');
});

for (const [name, ms] of Object.entries(clocks))
  test(`a change a person reported while an action ran has no owner when the clock is ${name}`, async (t) => {
    const step = clock(t, ms);
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await f.runtime.refresh();
    await f.agent(filter, 'open', async () => {
      step();
      await f.person(limit, 20);
    });
    const [, reported, set] = f.runtime.getProvenance().records;
    assert(reported?.kind === 'observation' && set?.kind === 'action');
    assert.deepEqual(reported.observation.state, { [filter]: 'open', [limit]: 20 });
    assert.deepEqual(set.before?.state, { [filter]: 'all', [limit]: 10 });
    assert.equal(f.origin(filter), 'unknown');
    assert.equal(f.origin(limit), 'unknown');
  });

test('a value a person reported in two steps while an action ran has no owner', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open', async () => {
    await f.person(limit, 1);
    await f.person(limit, 12);
  });
  const set = f.runtime.getProvenance().records.at(-1);
  assert(set?.kind === 'action');
  assert.deepEqual([set.before?.state[limit], set.observation?.state[limit]], [10, 12]);
  assert.equal(f.origin(limit), 'unknown');
});

test('an action keeps its change when an overlapping query recorded it first', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open', async () => {
    await f.count();
  });
  const [query, set] = f.runtime.getProvenance().records;
  assert(query?.kind === 'action' && query.execution.operationKind === 'query');
  assert.equal(query.observation?.state[filter], 'open');
  assert.equal(f.origin(filter), set);
});

test('an action keeps a change a query showed first, but not one a person reported', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open', async () => {
    await f.count();
    await f.person(limit, 20);
  });
  const [, query, reported, set] = f.runtime.getProvenance().records;
  assert(query?.kind === 'action' && reported?.kind === 'observation' && set?.kind === 'action');
  assert.equal(query.observation?.state[filter], 'open');
  assert.equal(reported.observation.state[filter], 'open');
  assert.equal(f.origin(filter), set);
  assert.equal(f.origin(limit), 'unknown');
});

test('changes of two actions that ran at the same time have no owner', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await Promise.all([f.agent(filter, 'open'), f.agent(limit, 20)]);
  const [, first, second] = f.runtime.getProvenance().records;
  assert(first?.kind === 'action' && second?.kind === 'action');
  assert.deepEqual(second.before?.state, { [filter]: 'all', [limit]: 10 });
  assert.deepEqual(first.observation?.state, { [filter]: 'open', [limit]: 20 });
  assert.equal(f.origin(filter), 'unknown');
  assert.equal(f.origin(limit), 'unknown');
});

for (const [count, writers] of [
  ['three', 3],
  ['five', 5],
] as const)
  test(`a value ${count} actions set at the same time has no owner`, async (t) => {
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await f.runtime.refresh();
    await Promise.all(Array.from({ length: writers }, () => f.agent(filter, 'open')));
    const [, ...sets] = f.runtime.getProvenance().records;
    assert.deepEqual(
      sets.map((set) => set.kind === 'action' && [set.before?.state[filter], set.observation?.state[filter]]),
      Array.from({ length: writers }, () => ['all', 'open']),
    );
    assert.equal(f.origin(filter), 'unknown');
  });

/** Ways the journal can show `filter` as `open`, with no record owning it, before an unreported edit hides it. */
const shownOpen: Record<string, (f: ReturnType<typeof fixture>) => Promise<unknown>> = {
  'a refresh showed it first': (f) => {
    f.state[filter] = 'open';
    return f.runtime.refresh();
  },
  'an action’s before showed it first': (f) => {
    f.state[filter] = 'open';
    return f.agent(limit, 20);
  },
};

for (const [when, show] of Object.entries(shownOpen))
  test(`an action that sets a value again after an unreported edit owns it when ${when}`, async (t) => {
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await show(f);
    f.state[filter] = 'hidden';
    await f.agent(filter, 'open');
    const set = f.runtime.getProvenance().records.at(-1);
    assert(set?.kind === 'action');
    assert.deepEqual([set.before?.state[filter], set.observation?.state[filter]], ['hidden', 'open']);
    assert.equal(f.origin(filter), set);
  });

/**
 * Ways a record can set `filter` to `open` before an unreported edit changes it and an action sets
 * `open` again. The journal cannot tell that action from one that ran while the record set the value.
 */
const setOpen: Record<string, { historyLimit?: number; edit: unknown }> = {
  'an earlier action set it': { edit: 'hidden' },
  'an edit undid an earlier action': { edit: 'all' },
  'a dropped record could have set it': { historyLimit: 2, edit: 'hidden' },
};

for (const [when, { historyLimit, edit }] of Object.entries(setOpen))
  for (const [name, ms] of Object.entries(clocks))
    test(`an action that sets a value again after an unreported edit has no owner when ${when} and the clock is ${name}`, async (t) => {
      const step = clock(t, ms);
      const f = fixture({ historyLimit });
      t.after(() => f.runtime.dispose());
      await f.runtime.refresh();
      await f.agent(filter, 'open');
      if (historyLimit) {
        await f.agent(limit, 20);
        await f.agent(limit, 30);
      }
      step();
      f.state[filter] = edit;
      await f.agent(filter, 'open');
      const { records, revision } = f.runtime.getProvenance();
      const set = records.at(-1);
      assert(set?.kind === 'action');
      assert.deepEqual([set.before?.state[filter], set.observation?.state[filter]], [edit, 'open']);
      assert.equal(revision > records.length, Boolean(historyLimit));
      assert.equal(f.origin(filter), 'unknown');
    });

test('a change observed during an action is unknown until the action’s record owns it', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const observed = new Promise<ReturnType<typeof f.origin>>((resolve) => {
    const stop = f.runtime.subscribeProvenance(({ record }) => {
      if (record?.kind !== 'observation' || record.cause.kind !== 'concurrent') return;
      stop();
      resolve(f.origin(filter));
    });
  });
  await f.runtime.refresh();
  await f.agent(filter, 'open', async () => {
    f.invalidate();
    await observed;
  });
  assert.equal(await observed, 'unknown');
  const [, concurrent, set] = f.runtime.getProvenance().records;
  assert(concurrent?.kind === 'observation' && concurrent.cause.kind === 'concurrent');
  assert.equal(concurrent.observation.state[filter], 'open');
  assert.equal(f.origin(filter), set);
});

/** A read that overlapped `set` can finish after its record, holding a later change to the limit. */
function lateRead(set: VacpProvenanceRecord): VacpProvenanceRecord {
  assert(set.kind === 'action' && set.observation);
  return {
    id: 'late',
    at: set.at,
    kind: 'observation',
    cause: { kind: 'concurrent', executions: [{ executionId: set.execution.id }] },
    actor: { id: 'system', kind: 'system' },
    observation: { ...set.observation, state: { ...set.observation.state, [limit]: 20 } },
  };
}

test('a concurrent observation recorded after its executions owns the change it shows', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  const { records, revision } = f.runtime.getProvenance();
  const late = lateRead(records[0]!);
  assert.equal(provenanceAttribution({ records: [...records, late], revision: revision + 1 }, limit), late);
});

test('a concurrent observation whose execution’s record was dropped shows a change with no owner', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  await f.count();
  const [set, query] = f.runtime.getProvenance().records;
  const late = lateRead(set!);
  f.state[limit] = 20;
  await f.person(filter, 'closed');
  const reported = f.runtime.getProvenance().records.at(-1)!;
  // The journal dropped `set`, the oldest of its four records.
  assert.equal(provenanceAttribution({ records: [query!, late, reported], revision: 4 }, limit), 'unknown');
});

test('a change that only a query or a rejected action shows is unknown', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  await f.count(async () => {
    f.state[filter] = 'hidden';
  });
  assert.equal(f.origin(filter), 'unknown');
  await f.agent(limit, 20);
  f.state[limit] = 5;
  assert.equal((await f.runtime.execute({ name: 'missing' })).ok, false);
  assert.equal(f.origin(limit), 'unknown');
});

test('an action without a captured result leaves its change unknown', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open', async () => f.failReads(true));
  f.failReads(false);
  const [set] = f.runtime.getProvenance().records;
  assert(set?.kind === 'action' && set.before && !set.observation);
  assert.equal(f.origin(filter), 'unknown');
  await f.person(limit, 20);
  assert.equal(f.origin(filter), 'unknown');
  await f.agent(limit, 25, async () => f.failReads(true));
  f.failReads(false);
  await f.agent(filter, 'closed');
  await f.person(limit, 30);
  assert.equal(action(f.origin(filter)).call.callId, `set ${filter} closed`);
  assert.equal(recorded(f.origin(limit)).kind, 'observation');
});

/** Records that start from `hidden`, an unreported edit, and leave no captured result. */
const unfinished: Record<string, (f: ReturnType<typeof fixture>) => Promise<unknown>> = {
  'an action setting the value again': (f) => f.agent(filter, 'open', async () => f.failReads(true)),
  'a query': (f) => f.count(async () => f.failReads(true)),
};

for (const [what, start] of Object.entries(unfinished))
  for (const [name, ms] of Object.entries(clocks))
    test(`${what} that starts from an unreported edit and leaves no result makes the value unknown when the clock is ${name}`, async (t) => {
      const step = clock(t, ms);
      const f = fixture();
      t.after(() => f.runtime.dispose());
      await f.runtime.refresh();
      await f.agent(filter, 'open');
      step();
      f.state[filter] = 'hidden';
      await start(f);
      f.failReads(false);
      const last = f.runtime.getProvenance().records.at(-1);
      assert(last?.kind === 'action' && !last.observation);
      assert.equal(last.before?.state[filter], 'hidden');
      step();
      await f.person(limit, 20);
      assert.equal(f.origin(filter), 'unknown');
      await f.person(filter, 'closed');
      assert.equal(f.origin(filter), f.runtime.getProvenance().records.at(-1));
    });

test('only the first change reported after an action without a captured result is unknown', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open', async () => f.failReads(true));
  f.failReads(false);
  await f.person(limit, 20);
  assert.equal(f.origin(limit), 'unknown');
  await f.person(limit, 30);
  assert.equal(f.origin(limit), f.runtime.getProvenance().records.at(-1));
});

/** A person sets the limit, then the agent opens and closes the filter and raises the limit. */
async function edit(f: ReturnType<typeof fixture>) {
  await f.runtime.refresh();
  await f.person(limit, 15);
  const reported = recorded(f.origin(limit));
  await f.agent(filter, 'open');
  const opened = recorded(f.origin(filter));
  await f.agent(filter, 'closed');
  await f.agent(limit, 20);
  return { reported, opened };
}

test('reviewing a checkpoint returns each value to the record that last set it', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const { reported, opened } = await edit(f);
  const replay = createProvenanceReplay(f.runtime, { restore: createVacpRestorer(f.runtime).restore });
  t.after(() => replay.dispose());
  await replay.review(replay.getState().steps.find((step) => step.record === opened)!.id);
  assert.deepEqual(f.state, { [filter]: 'open', [limit]: 15 });
  assert.equal(f.origin(filter), opened);
  assert.equal(f.origin(limit), reported);
});

test('closing review returns every value to its owner before review', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await edit(f);
  const live = { [filter]: recorded(f.origin(filter)), [limit]: recorded(f.origin(limit)) };
  const replay = createProvenanceReplay(f.runtime, { restore: createVacpRestorer(f.runtime).restore });
  t.after(() => replay.dispose());
  for (const step of [...replay.getState().steps].reverse()) await replay.review(step.id);
  assert.deepEqual(f.state, { [filter]: 'all', [limit]: 10 });
  await replay.close();
  assert.deepEqual(f.state, { [filter]: 'closed', [limit]: 20 });
  assert.equal(f.origin(filter), live[filter]);
  assert.equal(f.origin(limit), live[limit]);
});

test('reviewing back and forth returns a value to its latest setter, never to a restoration', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open');
  await f.agent(filter, 'closed');
  const closed = recorded(f.origin(filter));
  await f.agent(filter, 'open');
  const reopened = recorded(f.origin(filter));
  const replay = createProvenanceReplay(f.runtime, { restore: createVacpRestorer(f.runtime).restore });
  t.after(() => replay.dispose());
  const review = (record: VacpProvenanceRecord) =>
    replay.review(replay.getState().steps.find((step) => step.record === record)!.id);
  await review(closed);
  assert.equal(f.origin(filter), closed);
  await review(reopened);
  assert.equal(f.origin(filter), reopened);
  await review(closed);
  assert.equal(f.origin(filter), closed);
});

test('a restored value no record of the session held names the restoration', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open');
  assert((await f.restore({ [filter]: 'archived' })).ok);
  const restoration = f.runtime.getProvenance().records.at(-1)!;
  assert(restoration.kind === 'action' && restoration.execution.restoration);
  assert.equal(f.origin(filter), restoration);
});

test('a restoration returns a value a query showed first to its owner', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open');
  const opened = recorded(f.origin(filter));
  await f.agent(filter, 'closed');
  assert((await f.restore({ [filter]: 'open' }, async () => void (await f.count()))).ok);
  const [query, restoration] = f.runtime.getProvenance().records.slice(-2);
  assert(query?.kind === 'action' && query.execution.operationKind === 'query' && restoration?.kind === 'action');
  assert.equal(query.observation?.state[filter], 'open');
  assert.equal(restoration.before?.state[filter], 'closed');
  assert.equal(f.origin(filter), opened);
});

/** Ways the journal can capture `filter` as `hidden` after an unreported edit, before an action closes it. */
const shownHidden: Record<string, (f: ReturnType<typeof fixture>) => Promise<unknown>> = {
  'a query showed it': (f) => f.count(),
  'only the action’s before showed it': async () => {},
};

for (const [when, show] of Object.entries(shownHidden))
  for (const [name, ms] of Object.entries(clocks))
    test(`a restored value an unreported edit set is unknown when ${when} and the clock is ${name}`, async (t) => {
      const step = clock(t, ms);
      const f = fixture();
      t.after(() => f.runtime.dispose());
      await f.runtime.refresh();
      await f.agent(filter, 'open');
      step();
      f.state[filter] = 'hidden';
      await show(f);
      await f.agent(filter, 'closed');
      assert((await f.restore({ [filter]: 'hidden' })).ok);
      assert.equal(f.origin(filter), 'unknown');
    });

test('a restored value whose earlier owner is no longer retained is unknown', async (t) => {
  const f = fixture({ historyLimit: 2 });
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  await f.agent(filter, 'closed');
  await f.agent(limit, 20);
  assert((await f.restore({ [filter]: 'open' })).ok);
  assert.equal(f.origin(filter), 'unknown');
});

for (const [name, ms] of Object.entries(clocks))
  test(`a restoration leaves a value the journal already shows with its owner when the clock is ${name}`, async (t) => {
    const step = clock(t, ms);
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await f.agent(filter, 'closed');
    const closed = recorded(f.origin(filter));
    step();
    // Unreported changes, so the restoration starts from values no record captured.
    f.state[filter] = 'hidden';
    f.state[limit] = 5;
    assert((await f.restore({ [filter]: 'closed', [limit]: 10 })).ok);
    assert.equal(f.origin(filter), closed);
    assert.equal(f.origin(limit), 'unchanged');
  });

test('a change a person reported while a restoration ran has no owner', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open');
  assert((await f.restore({ [filter]: 'all' }, () => f.person(limit, 20))).ok);
  const [, , reported, restoration] = f.runtime.getProvenance().records;
  assert(reported?.kind === 'observation' && restoration?.kind === 'action' && restoration.execution.restoration);
  assert.deepEqual(reported.observation.state, { [filter]: 'all', [limit]: 20 });
  assert.deepEqual(restoration.before?.state, { [filter]: 'open', [limit]: 10 });
  assert.equal(f.origin(filter), 'unknown');
  assert.equal(f.origin(limit), 'unknown');
});

test('a value a restoration set while an action ran on the same ref has no owner', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.agent(filter, 'open', async () => void (await f.restore({ [filter]: 'closed' })));
  const [, restoration, set] = f.runtime.getProvenance().records;
  assert(restoration?.kind === 'action' && restoration.execution.restoration && set?.kind === 'action');
  assert.deepEqual([set.before?.state[filter], set.observation?.state[filter]], ['all', 'closed']);
  assert.equal(f.origin(filter), 'unknown');
});

test('an action keeps its change when a restoration captured the same transition', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  assert((await f.restore({ [filter]: 'archived' })).ok);
  await f.agent(filter, 'archived');
  const { records, revision } = f.runtime.getProvenance();
  const [baseline, restoration, set] = records;
  assert(baseline && restoration?.kind === 'action' && set?.kind === 'action');
  // The action ran while the restoration applied the same value, and either one finished first.
  const overlapping: VacpProvenanceRecord = { ...set, before: restoration.before };
  for (const order of [
    [restoration, overlapping],
    [overlapping, restoration],
  ])
    assert.equal(provenanceAttribution({ records: [baseline, ...order], revision }, filter), overlapping);
});

test('a session boundary starts every ref unchanged, with no values from before it', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  const earlier = f.runtime.getProvenance().records;
  f.runtime.update({ providers: f.providers, sessionKey: 'next' });
  await f.agent(limit, 20);
  const acrossSessions = () => {
    const log = [...earlier, ...f.runtime.getProvenance().records];
    return provenanceAttribution({ records: log, revision: log.length }, filter);
  };
  assert.equal(f.runtime.getProvenance().records[0]?.kind, 'session');
  assert.equal(f.origin(filter), 'unchanged');
  assert.equal(acrossSessions(), 'unchanged');
  assert.equal(action(f.origin(limit)).call.callId, `set ${limit} 20`);
  assert((await f.restore({ [filter]: 'all' })).ok);
  const restoration = f.runtime.getProvenance().records.at(-1);
  assert.equal(f.origin(filter), restoration);
  assert.equal(acrossSessions(), restoration);
});

test('a ref whose last change is no longer retained is unknown', async (t) => {
  const f = fixture({ historyLimit: 2 });
  t.after(() => f.runtime.dispose());
  await f.agent(filter, 'open');
  await f.agent(limit, 20);
  await f.agent(limit, 30);
  const journal = f.runtime.getProvenance();
  assert(journal.revision > journal.records.length);
  assert.equal(f.origin(filter), 'unknown');
  assert.equal(f.origin(limit), journal.records[1]);
});

for (const [when, historyLimit] of [
  ['a query that showed the value is retained before it', 2],
  ['it is the only record retained', 1],
] as const)
  test(`the oldest retained action owns no change a dropped record could have reported when ${when}`, async (t) => {
    const f = fixture({ historyLimit });
    t.after(() => f.runtime.dispose());
    await f.agent(limit, 20, async () => {
      await f.person(filter, 'open');
      await f.count();
    });
    const journal = f.runtime.getProvenance();
    assert.deepEqual(
      journal.records.map((record) => record.kind === 'action' && record.execution.operationKind),
      ['query', 'mutation'].slice(-historyLimit),
    );
    assert.equal(f.origin(filter), 'unknown');
  });

for (const [name, ms] of Object.entries(clocks)) {
  test(`restoring a before value after actions repeat a transition is unknown when the clock is ${name}`, async (t) => {
    const step = clock(t, ms);
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await f.runtime.refresh();
    await f.agent(filter, 'hidden');
    await f.agent(filter, 'open');
    step();
    f.state[filter] = 'hidden';
    await f.agent(filter, 'open');
    step();
    assert((await f.restore({ [filter]: 'hidden' })).ok);
    assert.equal(f.origin(filter), 'unknown');
  });

  test(`restoring a before value after an action repeats a restoration is unknown when the clock is ${name}`, async (t) => {
    const step = clock(t, ms);
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await f.runtime.refresh();
    await f.agent(filter, 'hidden');
    assert((await f.restore({ [filter]: 'open' })).ok);
    step();
    f.state[filter] = 'hidden';
    await f.agent(filter, 'open');
    await f.agent(filter, 'closed');
    step();
    assert((await f.restore({ [filter]: 'hidden' })).ok);
    assert.equal(f.origin(filter), 'unknown');
  });

  for (const initial of ['human', 'action', 'baseline'] as const)
    test(`restoring a before value after a restoration repeats an action is unknown with ${initial} ownership when the clock is ${name}`, async (t) => {
      const step = clock(t, ms);
      const f = fixture();
      t.after(() => f.runtime.dispose());
      if (initial === 'baseline') f.state[filter] = 'hidden';
      await f.runtime.refresh();
      if (initial === 'human') await f.person(filter, 'hidden');
      if (initial === 'action') await f.agent(filter, 'hidden');
      await f.agent(filter, 'open');
      step();
      f.state[filter] = 'hidden';
      assert((await f.restore({ [filter]: 'open' })).ok);
      await f.agent(filter, 'closed');
      step();
      assert((await f.restore({ [filter]: 'hidden' })).ok);
      assert.equal(f.origin(filter), 'unknown');
    });

  test(`repeated checkpoint visits preserve an unreported before value as unknown when the clock is ${name}`, async (t) => {
    const step = clock(t, ms);
    const f = fixture();
    t.after(() => f.runtime.dispose());
    await f.runtime.refresh();
    await f.person(filter, 'hidden');
    await f.agent(filter, 'open');
    const opened = recorded(f.origin(filter));
    f.runtime.narrate({ actor: vacpAgentActor, message: 'The filter is open.', done: true });
    await f.person(filter, 'hidden');
    const replay = createProvenanceReplay(f.runtime, { restore: createVacpRestorer(f.runtime).restore });
    t.after(() => replay.dispose());
    const checkpoint = replay.getState().steps.find((entry) => entry.record === opened)!;
    await replay.review(checkpoint.id);
    assert.equal(f.origin(filter), opened);
    step();
    f.state[filter] = 'hidden';
    await replay.review(checkpoint.id);
    step();
    await replay.close();
    assert.equal(f.state[filter], 'hidden');
    assert.equal(f.origin(filter), 'unknown');
  });
}

for (const [name, ms] of Object.entries(clocks))
  for (const interleave of [false, true])
    test(`independent restoration captures ${interleave ? 'make an unreported before value unknown' : 'preserve a reported value'} when the clock is ${name}`, async (t) => {
      const step = clock(t, ms);
      const f = fixture();
      t.after(() => f.runtime.dispose());
      await f.runtime.refresh();
      await f.person(filter, 'hidden');
      await f.agent(filter, 'open');
      await f.person(filter, 'hidden');
      const hiddenOwner = recorded(f.origin(filter));
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      t.after(release);
      let restoring = true;
      t.after(
        f.runtime.addExecutionGate(
          (execution) => {
            if (restoring && execution.restoration && execution.sourceId === 'vacp-source://settings/limit')
              return wait;
          },
          { timeoutMs: 1000 },
        ),
      );
      t.after(
        f.runtime.subscribeProvenance(({ record }) => {
          if (
            restoring &&
            record?.kind === 'action' &&
            record.execution.restoration &&
            record.execution.sourceId === 'vacp-source://settings/filter'
          ) {
            step();
            if (interleave) f.state[filter] = 'hidden';
            release();
          }
        }),
      );
      t.after(
        f.runtime.subscribeExecutions((execution) => {
          if (
            restoring &&
            execution.restoration &&
            execution.sourceId === 'vacp-source://settings/limit' &&
            execution.phase === 'running'
          ) {
            step();
            if (interleave) f.state[filter] = 'open';
          }
        }),
      );
      assert((await f.restore({ [filter]: 'open', [limit]: 20 })).ok);
      restoring = false;
      const [first, second] = f.runtime.getProvenance().records.slice(-2);
      assert(first?.kind === 'action' && second?.kind === 'action');
      const siblings = [first, second];
      assert.deepEqual(
        siblings.map((record) => record.before?.state[filter]),
        ['hidden', interleave ? 'hidden' : 'open'],
      );
      assert.deepEqual(
        siblings.map((record) => record.observation?.state[filter]),
        ['open', 'open'],
      );
      step();
      assert((await f.restore({ [filter]: 'hidden' })).ok);
      const journal = f.runtime.getProvenance();
      const serialized: typeof journal = JSON.parse(JSON.stringify(journal));
      for (const captured of [journal, serialized]) {
        const origin = provenanceAttribution(captured, filter);
        if (interleave) assert.equal(origin, 'unknown');
        else assert.equal(recorded(origin).id, hiddenOwner.id);
      }
      assert.equal(typeof first.beforeCaptureId, 'string');
      assert.equal(typeof second.beforeCaptureId, 'string');
      assert.notEqual(first.beforeCaptureId, second.beforeCaptureId);
    });

test('restoration records with unspecified capture identity keep a differing before value unknown', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  await f.person(filter, 'hidden');
  await f.agent(filter, 'open');
  await f.person(filter, 'hidden');
  const hiddenOwner = recorded(f.origin(filter));
  assert((await f.restore({ [filter]: 'open', [limit]: 20 })).ok);
  assert((await f.restore({ [filter]: 'hidden' })).ok);
  const journal = f.runtime.getProvenance();
  assert.equal(provenanceAttribution(journal, filter), hiddenOwner);
  const records = journal.records.map((record) => {
    if (record.kind !== 'action') return record;
    const { beforeCaptureId: _capture, ...captured } = record;
    return captured;
  });
  assert.equal(provenanceAttribution({ ...journal, records }, filter), 'unknown');
});
