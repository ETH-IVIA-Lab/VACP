import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION, type VacpCapabilitiesSnapshot } from '@vacp/protocol';
import { createVacpRuntime, VacpActionRegistry } from '../src/index';

function snapshots(title: string) {
  return {
    getCapabilities: (): VacpCapabilitiesSnapshot => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: '',
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: 'vacp://view', title, kind: 'View', layer: 'ViewLayer' }],
        edges: [],
        actions: [],
      },
    }),
    getState: () => ({ version: VACP_SCHEMA_VERSION, createdAt: '', state: {} }),
  };
}

test('capability observers see the live graph even during inspection, and disposal cancels reads', async () => {
  const runtime = createVacpRuntime({ snapshots: snapshots('live'), actions: new VacpActionRegistry() });
  const titles: string[] = [];
  runtime.subscribeCapabilities((value) => titles.push(value.graph.nodes[0]?.title ?? ''));
  try {
    await runtime.getCapabilities();
    runtime.setGraphOverride({ version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: [] });
    await runtime.getRuntime();
    assert.deepEqual(titles, ['live']);
    runtime.update({ snapshots: snapshots('replacement'), actions: new VacpActionRegistry() });
    await runtime.getCapabilities();
    assert.deepEqual(titles, ['live', 'replacement']);
  } finally {
    runtime.dispose();
  }
  assert.equal(runtime.signal.aborted, true);
  await assert.rejects(runtime.getCapabilities(), /abort/i);
});

test('a late snapshot from a replaced provider cannot overwrite current capabilities', async () => {
  let complete!: (value: VacpCapabilitiesSnapshot) => void;
  const old = snapshots('old');
  const runtime = createVacpRuntime({
    snapshots: {
      ...old,
      getCapabilities: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
    actions: new VacpActionRegistry(),
  });
  try {
    const pending = runtime.getCapabilities();
    runtime.update({ snapshots: snapshots('new'), actions: new VacpActionRegistry() });
    complete(old.getCapabilities());
    assert.equal((await pending).graph.nodes[0]?.title, 'new');
  } finally {
    runtime.dispose();
  }
});

test('execution owns live-mode recovery and honours cancellation before calling a handler', async () => {
  let executions = 0;
  const actions = new VacpActionRegistry();
  actions.register({ name: 'set', description: 'Set a value' }, () => {
    executions++;
  });
  const runtime = createVacpRuntime({ snapshots: snapshots('live'), actions });
  try {
    runtime.setMode('inspect');
    await runtime.execute({ callId: 'first', name: 'set' });
    assert.equal((await runtime.getRuntime()).mode, 'live');
    assert.equal(executions, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runtime.execute({ callId: 'cancelled', name: 'set' }, { signal: controller.signal }),
      /abort/i,
    );
    assert.equal(executions, 1);
  } finally {
    runtime.dispose();
  }
});

test('a queued action cannot execute against a replacement provider', async () => {
  let complete!: (value: VacpCapabilitiesSnapshot) => void;
  let called = 0;
  const actions = new VacpActionRegistry();
  actions.register({ name: 'set', description: 'Set value' }, () => {
    called++;
  });
  const old = snapshots('old');
  const runtime = createVacpRuntime({
    snapshots: {
      ...old,
      getCapabilities: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
    actions,
  });
  try {
    const execution = runtime.execute({ callId: 'old', name: 'set' });
    const rejected = assert.rejects(execution, /abort/i);
    // dispatch awaits the replay queue before reading the provider.
    await Promise.resolve();
    runtime.update({ snapshots: snapshots('new'), actions });
    complete(old.getCapabilities());
    await rejected;
    assert.equal(called, 0);
  } finally {
    runtime.dispose();
  }
});

test('a late post-action snapshot cannot attach an old call to a new session history', async () => {
  let finishRead!: () => void;
  let afterStarted!: () => void;
  const after = new Promise<void>((resolve) => {
    afterStarted = resolve;
  });
  const actions = new VacpActionRegistry();
  actions.register({ name: 'set', description: 'Set value' }, () => 'old result');
  let reads = 0;
  const initial = snapshots('old');
  const runtime = createVacpRuntime({
    actions,
    sessionKey: 'old',
    snapshots: {
      ...initial,
      getState: async () => {
        if (++reads === 2) {
          afterStarted();
          await new Promise<void>((resolve) => {
            finishRead = resolve;
          });
        }
        return initial.getState();
      },
    },
  });
  try {
    const execution = runtime.execute({ callId: 'old-call', name: 'set' });
    const rejected = assert.rejects(execution, /abort/i);
    await after;
    runtime.update({ snapshots: snapshots('new'), actions, sessionKey: 'new' });
    finishRead();
    await rejected;
    assert.equal(
      (await runtime.getRuntime()).history.some((entry) => entry.call?.callId === 'old-call'),
      false,
    );
  } finally {
    runtime.dispose();
  }
});

test('subscribed snapshots detect in-place graph and summary edits without timestamp churn', async () => {
  const capabilities = snapshots('before subscription').getCapabilities();
  const state = { version: VACP_SCHEMA_VERSION, createdAt: '', state: {}, summary: { 'vacp://view': 'first' } };
  const runtime = createVacpRuntime({
    actions: new VacpActionRegistry(),
    snapshots: { getCapabilities: () => capabilities, getState: () => state },
  });
  const titles: string[] = [];
  const summaries: string[] = [];
  try {
    await runtime.getCapabilities();
    runtime.subscribeCapabilities((value) => titles.push(value.graph.nodes[0]!.title!));
    runtime.subscribeSnapshots((value) => summaries.push(String(value.state.summary?.['vacp://view'])));
    runtime.stopObserving();
    await runtime.getCapabilities();
    capabilities.createdAt = 'new timestamp';
    state.createdAt = 'new timestamp';
    await runtime.getCapabilities();
    assert.deepEqual(titles, ['before subscription']);
    assert.deepEqual(summaries, ['first']);
    capabilities.graph.nodes[0]!.title = 'edited in place';
    state.summary['vacp://view'] = 'second';
    await runtime.getCapabilities();
    state.summary['vacp://view'] = 'summary only';
    await runtime.getCapabilities();
    assert.deepEqual(titles, ['before subscription', 'edited in place']);
    assert.deepEqual(summaries, ['first', 'second', 'summary only']);
  } finally {
    runtime.dispose();
  }
});
