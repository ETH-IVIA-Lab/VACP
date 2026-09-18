import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VACP_SCHEMA_VERSION,
  type VacpActionDescriptor,
  type VacpProvider,
  type VacpProviderObservation,
} from '@vacp/protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '../src/index';

const source = { id: 'vacp-source://runtime-test' as const, type: 'test', title: 'Runtime test' };

function provider(title: string, actions = new VacpActionRegistry()): VacpProvider {
  return createVacpProvider({
    source,
    actions,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: 'vacp://view', title, kind: 'View', layer: 'ViewLayer' }],
        edges: [],
      },
      state: {},
    }),
  });
}

function descriptor(name: string): VacpActionDescriptor {
  return { name, description: `${name} value`, operation: { kind: 'mutation', affects: ['vacp://view'] } };
}

test('capability observers see the live graph even during inspection, and disposal cancels reads', async () => {
  const runtime = createVacpRuntime({ providers: [provider('live')] });
  const titles: string[] = [];
  runtime.subscribeCapabilities((value) => titles.push(value.graph.nodes[0]?.title ?? ''));
  try {
    const live = await runtime.getCapabilities();
    runtime.setGraphOverride({ ...live.graph, nodes: [], edges: [], ownership: { nodes: {}, actions: {} } });
    await runtime.getRuntime();
    assert.deepEqual(titles, ['live']);
    runtime.update({ providers: [provider('replacement')] });
    await runtime.getCapabilities();
    assert.deepEqual(titles, ['live', 'replacement']);
  } finally {
    runtime.dispose();
  }
  assert.equal(runtime.signal.aborted, true);
  await assert.rejects(runtime.getCapabilities(), /abort/i);
});

test('a late observation from a replaced provider cannot overwrite current capabilities', async () => {
  let complete!: (value: VacpProviderObservation) => void;
  const old: VacpProvider = {
    source,
    observe: () => new Promise((resolve) => (complete = resolve)),
    execute: async (call) => ({ callId: call.callId, ok: true }),
  };
  const runtime = createVacpRuntime({ providers: [old] });
  try {
    const pending = runtime.getCapabilities();
    runtime.update({ providers: [provider('new')] });
    complete(await provider('old').observe());
    assert.equal((await pending).graph.nodes[0]?.title, 'new');
  } finally {
    runtime.dispose();
  }
});

test('execution owns live-mode recovery and honours cancellation before calling a handler', async () => {
  let executions = 0;
  const actions = new VacpActionRegistry();
  actions.register(descriptor('set'), () => {
    executions++;
  });
  const runtime = createVacpRuntime({ providers: [provider('live', actions)] });
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
  let complete!: (value: VacpProviderObservation) => void;
  let called = 0;
  const actions = new VacpActionRegistry();
  actions.register(descriptor('set'), () => called++);
  const old: VacpProvider = {
    source,
    observe: () => new Promise((resolve) => (complete = resolve)),
    execute: (call, options) => actions.execute(call, options),
  };
  const runtime = createVacpRuntime({ providers: [old] });
  try {
    const execution = runtime.execute({ callId: 'old', name: 'set' });
    const rejected = assert.rejects(execution, /abort/i);
    await Promise.resolve();
    runtime.update({ providers: [provider('new', actions)] });
    complete(await provider('old', actions).observe());
    await rejected;
    assert.equal(called, 0);
  } finally {
    runtime.dispose();
  }
});

test('a late post-action observation cannot attach an old call to a new session history', async () => {
  let finishRead!: () => void;
  let afterStarted!: () => void;
  const after = new Promise<void>((resolve) => (afterStarted = resolve));
  const actions = new VacpActionRegistry();
  actions.register(descriptor('set'), () => 'old result');
  let reads = 0;
  const base = provider('old', actions);
  const old: VacpProvider = {
    source,
    execute: (call, options) => actions.execute(call, options),
    observe: async () => {
      if (++reads === 2) {
        afterStarted();
        await new Promise<void>((resolve) => (finishRead = resolve));
      }
      return base.observe();
    },
  };
  const runtime = createVacpRuntime({ providers: [old], sessionKey: 'old' });
  try {
    const execution = runtime.execute({ callId: 'old-call', name: 'set' });
    const rejected = assert.rejects(execution, /abort/i);
    await after;
    runtime.update({ providers: [provider('new', actions)], sessionKey: 'new' });
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
  const graph = {
    version: VACP_SCHEMA_VERSION,
    nodes: [{ ref: 'vacp://view' as const, title: 'before subscription', kind: 'View', layer: 'ViewLayer' }],
    edges: [],
  };
  const summary: Record<'vacp://view', string> = { 'vacp://view': 'first' };
  const sourceProvider = createVacpProvider({
    source,
    actions: new VacpActionRegistry(),
    project: () => ({ graph, state: {}, summary }),
  });
  const runtime = createVacpRuntime({ providers: [sourceProvider] });
  const titles: string[] = [];
  const summaries: string[] = [];
  try {
    await runtime.getCapabilities();
    runtime.subscribeCapabilities((value) => titles.push(value.graph.nodes[0]!.title!));
    runtime.subscribeSnapshots((value) => summaries.push(String(value.state.summary?.['vacp://view'])));
    runtime.stopObserving();
    await runtime.getCapabilities();
    await runtime.getCapabilities();
    assert.deepEqual(titles, ['before subscription']);
    assert.deepEqual(summaries, ['first']);
    graph.nodes[0]!.title = 'edited in place';
    summary['vacp://view'] = 'second';
    await runtime.getCapabilities();
    summary['vacp://view'] = 'summary only';
    await runtime.getCapabilities();
    assert.deepEqual(titles, ['before subscription', 'edited in place']);
    assert.deepEqual(summaries, ['first', 'second', 'summary only']);
  } finally {
    runtime.dispose();
  }
});

test('freshness changes publish observations and history retains the observed revision', async () => {
  let status: 'current' | 'stale' = 'current';
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        source,
        actions: new VacpActionRegistry(),
        project: () => ({
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [{ ref: 'vacp://view', kind: 'Visualization', layer: 'VisualizationLayer' }],
            edges: [],
          },
          state: {},
          freshness: { 'vacp://view': { status } },
        }),
      }),
    ],
  });
  const published: string[] = [];
  const stop = runtime.subscribeSnapshots(({ observation }) =>
    published.push(observation.freshness!['vacp://view'].status),
  );
  try {
    await runtime.refresh();
    const first = await runtime.observe();
    status = 'stale';
    await runtime.refresh();
    assert.deepEqual(published, ['current', 'stale']);
    runtime.setCursor(0);
    const inspected = await runtime.getRuntime();
    assert.equal(inspected.currentObservation.revision, first.revision);
    assert.equal(inspected.currentObservation.freshness!['vacp://view'].status, 'current');
    assert.equal(inspected.liveObservation.freshness!['vacp://view'].status, 'stale');
  } finally {
    stop();
    runtime.dispose();
  }
});

test('replacing an unrelated source preserves an in-flight action', async () => {
  let started!: () => void;
  let finish!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const actions = new VacpActionRegistry();
  actions.register(descriptor('wait'), async (_params, { signal }) => {
    started();
    await pending;
    signal?.throwIfAborted();
    return 'done';
  });
  const runtime = createVacpRuntime({ providers: [provider('running', actions)] });
  try {
    const call = runtime.execute({ callId: 'wait', name: 'wait' });
    await began;
    runtime.attachProvider(
      createVacpProvider({
        source: { id: 'vacp-source://unrelated', type: 'test', title: 'Unrelated' },
        actions: new VacpActionRegistry(),
        project: () => ({ graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [] }, state: {} }),
      }),
    );
    finish();
    assert.deepEqual(await call, { callId: 'wait', ok: true, result: 'done' });
  } finally {
    finish();
    runtime.dispose();
  }
});
