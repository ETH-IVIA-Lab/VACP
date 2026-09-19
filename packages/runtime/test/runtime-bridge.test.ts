import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION, type VacpRef } from '@vacp/protocol';
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
        source,
        actions,
        project: () => ({
          graph: { version: VACP_SCHEMA_VERSION, nodes: [{ ref, kind: 'Widget', layer: 'ConfigLayer' }], edges: [] },
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
  const historical = (await f.runtime.getRuntime()).history[0]!.observation!;
  f.values.one = 'live-one';
  f.values.two = 'live-two';
  await f.runtime.refresh();
  const otherViewer = (await f.runtime.getRuntime()).observation;
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
  assert.equal((await f.runtime.getRuntime()).history.filter((entry) => entry.kind === 'action').length, 2);
  assert.deepEqual(otherViewer.state, { 'vacp://restore/one': 'live-one', 'vacp://restore/two': 'live-two' });
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
        source: { id: 'vacp-source://ambiguous', title: 'Ambiguous', type: 'test' },
        actions,
        project: () => ({
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [{ ref: 'vacp://one', kind: 'Widget', layer: 'ConfigLayer' }],
            edges: [],
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
    calls.push(`${name}:${value}`);
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
  const entries = (await f.runtime.getRuntime()).history;
  assert.ok(entries.some((entry) => entry.afterState?.state['vacp://restore/two'] === 'fail'));
  assert.equal((await next).ok, true);
  assert.deepEqual(f.values, { one: 'next', two: 'next' });
});
