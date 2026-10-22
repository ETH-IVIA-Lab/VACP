import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpRef } from '@ethivia/vacp-protocol';
import {
  createVacpRuntime,
  createVacpProvider,
  createVacpRestorer,
  registerVacpApplyStateAction,
  VacpActionRegistry,
} from '../src/index';

function fixture(names: string[], apply: (name: string, state: Record<VacpRef, unknown>) => void | Promise<void>) {
  const values: Record<string, unknown> = Object.fromEntries(names.map((name) => [name, 'old']));
  const runtime = createVacpRuntime({
    providers: names.map((name) => {
      const source = { id: `vacp-source://restore/${name}` as const, type: 'test', title: name };
      const ref = `vacp://restore/${name}` as const;
      const actions = new VacpActionRegistry(source.id);
      registerVacpApplyStateAction(actions, (state) => async () => {
        await apply(name, state);
        values[name] = state[ref];
      });
      return createVacpProvider({
        subscribe: () => () => {},
        source,
        actions,
        project: () => ({
          graph: {
            nodes: [{ ref, kind: 'Widget', layer: 'ConfigLayer' }],
            edges: [],
            actions: actions.list(),
          },
          state: { [ref]: values[name] },
        }),
      });
    }),
  });
  return { runtime, values, restorer: createVacpRestorer(runtime) };
}

test('independent historical selections remain passive; explicit restoration follows normal execution', async (t) => {
  const received: Record<string, unknown>[] = [];
  const f = fixture(['one', 'two'], (_name, state) => {
    received.push(state);
  });
  t.after(() => f.runtime.dispose());
  await f.runtime.refresh();
  const historical = f.runtime
    .getProvenance()
    .records.filter((record) => record.kind === 'observation')[0]!.observation;
  f.values.one = 'live-one';
  f.values.two = 'live-two';
  await f.runtime.refresh();
  const otherViewer = await f.runtime.inspect();
  assert.deepEqual(Object.values(historical.state), ['old', 'old']);
  assert.deepEqual(Object.values(otherViewer.state), ['live-one', 'live-two']);
  assert.deepEqual(received, []);
  const phases: string[] = [];
  f.runtime.subscribeExecutions((event) => phases.push(event.phase));
  const restored = await f.restorer.restore(historical.state);
  assert.equal(restored.ok, true);
  if (restored.ok)
    assert.deepEqual(
      restored.result?.sources.map(({ sourceId, result }) => [sourceId, result.ok]),
      [
        ['vacp-source://restore/one', true],
        ['vacp-source://restore/two', true],
      ],
    );
  assert.deepEqual(received, [{ 'vacp://restore/one': 'old' }, { 'vacp://restore/two': 'old' }]);
  assert.equal(phases.filter((phase) => phase === 'succeeded').length, 2);
  assert.equal(f.runtime.getProvenance().records.filter((entry) => entry.kind === 'action').length, 2);
  assert.deepEqual(otherViewer.state, { 'vacp://restore/one': 'live-one', 'vacp://restore/two': 'live-two' });
});

test('restoration uses complete ownership while execution still requires an available restorer', async (t) => {
  let visible = true;
  let enabled = true;
  let value: unknown = 'recorded';
  let preparations = 0;
  const ref = 'vacp://selection';
  const actions = new VacpActionRegistry();
  const restore = registerVacpApplyStateAction(actions, (state) => {
    preparations++;
    return () => {
      value = state[ref];
    };
  });
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://chart', type: 'chart', title: 'Chart' },
        actions,
        project: () => ({
          graph: {
            nodes: [
              {
                ref,
                kind: 'Selection',
                layer: 'ViewLayer',
                availability: visible ? undefined : { unavailable: 'Chart hidden' },
              },
            ],
            edges: [],
            actions: [{ ...restore, availability: enabled ? undefined : { unavailable: 'Restoration disabled' } }],
          },
          state: { [ref]: value },
        }),
      }),
    ],
  });
  t.after(() => runtime.dispose());
  const recorded = await runtime.inspect();
  visible = false;
  value = 'live';
  assert.deepEqual((await runtime.observe()).state, {});
  const restorer = createVacpRestorer(runtime);
  assert.equal((await restorer.restore(recorded.state)).ok, true);
  assert.equal(value, 'recorded');
  assert.equal(preparations, 1);
  enabled = false;
  const blocked = await restorer.restore({ [ref]: 'blocked' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    const failure = blocked.error.details?.sources[0]?.result;
    assert.equal(failure?.ok, false);
    if (failure && !failure.ok)
      assert.deepEqual(failure.error.details, {
        code: 'action-unavailable',
        action: restore.name,
        status: { available: false, blockedBy: [], reason: 'Restoration disabled' },
      });
  }
  assert.equal(value, 'recorded');
  assert.equal(preparations, 1);
});

test('unknown restoration ownership fails before any source is mutated', async (t) => {
  let calls = 0;
  const f = fixture(['one'], () => {
    calls++;
  });
  t.after(() => f.runtime.dispose());
  const result = await f.restorer.restore({ 'vacp://restore/one': 'new', 'vacp://missing': 'new' });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test('ambiguous restoration contracts fail before invoking any handler', async (t) => {
  let mutations = 0;
  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, () => () => {
    mutations++;
  });
  actions.register(
    {
      name: 'alternate.restore',
      description: 'Alternate',
      operation: { kind: 'mutation', contract: 'vacp.apply_state' },
    },
    () => {
      mutations++;
    },
  );
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://ambiguous', title: 'Ambiguous', type: 'test' },
        actions,
        project: () => ({
          graph: {
            nodes: [{ ref: 'vacp://one', kind: 'Widget', layer: 'ConfigLayer' }],
            edges: [],
            actions: actions.list(),
          },
          state: { 'vacp://one': 1 },
        }),
      }),
    ],
  });
  t.after(() => runtime.dispose());
  const result = await createVacpRestorer(runtime).restore({ 'vacp://one': 2 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /multiple state restorers/);
  assert.equal(mutations, 0);
});

test('failed restoration waits for all sources before the next explicit restoration and reports partial state', async (t) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const calls: string[] = [];
  const f = fixture(['one', 'two'], async (name, state) => {
    const value = state[`vacp://restore/${name}`];
    calls.push(`${name}:${String(value)}`);
    if (value === 'fail' && name === 'one') throw new Error('Cannot restore one');
    if (value === 'fail' && name === 'two') {
      started();
      await blocked;
    }
  });
  t.after(() => {
    release();
    f.runtime.dispose();
  });
  const first = f.restorer.restore({ 'vacp://restore/one': 'fail', 'vacp://restore/two': 'fail' });
  await began;
  const next = f.restorer.restore({ 'vacp://restore/one': 'next', 'vacp://restore/two': 'next' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['one:fail', 'two:fail']);
  release();
  const failed = await first;
  assert.equal(failed.ok, false);
  const entries = f.runtime.getProvenance().records;
  assert.ok(
    entries.some((entry) => 'observation' in entry && entry.observation?.state['vacp://restore/two'] === 'fail'),
  );
  assert.equal((await next).ok, true);
  assert.deepEqual(f.values, { one: 'next', two: 'next' });
});

test('shared before reads retain one capture identity through serialized provenance', async (t) => {
  const f = fixture(['one', 'two'], () => {});
  t.after(() => f.runtime.dispose());
  const state = { 'vacp://restore/one': 'saved', 'vacp://restore/two': 'saved' };
  const restoration = { id: 'viewer', entryId: 'checkpoint' };
  assert((await f.restorer.restore(state, { restoration })).ok);
  const journal = f.runtime.getProvenance();
  const serialized: typeof journal = JSON.parse(JSON.stringify(journal));
  for (const captured of [journal, serialized]) {
    const records = captured.records.filter((record) => record.kind === 'action');
    assert.equal(records.length, 2);
    assert.equal(typeof records[0]!.beforeCaptureId, 'string');
    assert.equal(records[0]!.beforeCaptureId, records[1]!.beforeCaptureId);
    assert.deepEqual(
      records.map((record) => record.execution.restoration),
      [restoration, restoration],
    );
  }
});

test('distinct before reads of equal observations retain distinct capture identities', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
  const f = fixture(['one'], () => {});
  t.after(() => f.runtime.dispose());
  const state = { 'vacp://restore/one': 'old' };
  assert((await f.restorer.restore(state)).ok);
  assert((await f.restorer.restore(state)).ok);
  const journal = f.runtime.getProvenance();
  const serialized: typeof journal = JSON.parse(JSON.stringify(journal));
  for (const captured of [journal, serialized]) {
    const records = captured.records.filter((record) => record.kind === 'action');
    assert.equal(records.length, 2);
    assert.deepEqual(records[0]!.before, records[1]!.before);
    assert.equal(typeof records[0]!.beforeCaptureId, 'string');
    assert.equal(typeof records[1]!.beforeCaptureId, 'string');
    assert.notEqual(records[0]!.beforeCaptureId, records[1]!.beforeCaptureId);
  }
});
