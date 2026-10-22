import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@ethivia/vacp-runtime';
import { createInspectorSession } from '../src/index';
import { createRuntimeInspectorClient } from '../src/runtime';
import { whenState } from './fixtures';

test('runtime connections observe and execute against a host-owned provider', async () => {
  let value = 0;
  const actions = new VacpActionRegistry();
  actions.register(
    {
      name: 'increment',
      description: 'Increment the parameter',
      operation: { kind: 'mutation', affects: ['vacp://value'] },
    },
    async () => {
      value++;
      return value;
    },
  );
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        subscribe: () => () => {},
        source: { id: 'vacp-source://test', type: 'test', title: 'Test' },
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
  const subscription = { started: 0, stopped: 0 };
  const session = createInspectorSession(
    createRuntimeInspectorClient({
      id: runtime.runtimeId,
      title: 'Test',
      runtime: {
        inspect: () => runtime.inspect(),
        execute: (call, options) => runtime.execute(call, options),
        subscribeSnapshots: (listener) => {
          subscription.started++;
          const unsubscribe = runtime.subscribeSnapshots(listener);
          return () => {
            subscription.stopped++;
            unsubscribe();
          };
        },
      },
    }),
  );
  try {
    const ready = whenState(session, (state) => state.status === 'ready');
    session.start();
    await ready;
    assert.equal(subscription.started, 1);
    assert.equal(session.getState().observation?.state['vacp://value'], 0);
    await session.execute({ name: 'increment' });
    await whenState(session, (state) => state.observation?.state['vacp://value'] === 1);
    assert.equal(session.getState().observation?.state['vacp://value'], 1);
    session.dispose();
    assert.equal(subscription.stopped, 1);
    assert.equal((await runtime.observe()).state['vacp://value'], 1);
  } finally {
    session.dispose();
    runtime.dispose();
  }
});

test('inspection follows availability and freshness changes while analytical state stays constant', async (t) => {
  let ready = false;
  let invalidate = () => {};
  const provider = createVacpProvider({
    source: { id: 'vacp-source://live', type: 'test', title: 'Live' },
    actions: new VacpActionRegistry(),
    subscribe: (listener) => {
      invalidate = listener;
      return () => {};
    },
    project: () => ({
      graph: {
        nodes: [
          {
            ref: 'vacp://view',
            kind: 'View',
            layer: 'ViewLayer',
            availability: ready ? undefined : { unavailable: 'Loading' },
          },
        ],
        edges: [],
        actions: [],
      },
      state: { 'vacp://view': 1 },
      freshness: { 'vacp://view': ready ? { status: 'current' } : { status: 'running' } },
    }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  t.after(() => runtime.dispose());
  const session = createInspectorSession(createRuntimeInspectorClient({ id: 'live', title: 'Live', runtime }));
  t.after(() => session.dispose());
  session.start();
  await whenState(session, (state) => state.status === 'ready');
  const records = runtime.getProvenance().records.length;
  ready = true;
  invalidate();
  await runtime.observe();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(session.getState().observation?.state, { 'vacp://view': 1 });
  assert.equal(session.getState().observation?.graph.nodes[0]?.availability?.unavailable, undefined);
  assert.equal(session.getState().observation?.freshness?.['vacp://view']?.status, 'current');
  assert.equal(runtime.getProvenance().records.length, records);
});
