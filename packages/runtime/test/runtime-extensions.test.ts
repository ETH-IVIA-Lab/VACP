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

test('capability observers follow live replacements, and disposal cancels reads', async () => {
  const runtime = createVacpRuntime({ providers: [provider('live')] });
  const titles: string[] = [];
  runtime.subscribeCapabilities((value) => titles.push(value.graph.nodes[0]?.title ?? ''));
  try {
    await runtime.getCapabilities();
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
    prepare: async (call) => ({ intent: { affects: [] }, execute: async () => ({ callId: call.callId, ok: true }) }),
  };
  const runtime = createVacpRuntime({ providers: [old] });
  try {
    const pending = runtime.getCapabilities();
    await Promise.resolve();
    runtime.update({ providers: [provider('new')] });
    complete(await provider('old').observe());
    assert.equal((await pending).graph.nodes[0]?.title, 'new');
  } finally {
    runtime.dispose();
  }
});

test('execution honours cancellation before calling a handler', async () => {
  let executions = 0;
  const actions = new VacpActionRegistry();
  actions.register(descriptor('set'), () => {
    executions++;
  });
  const runtime = createVacpRuntime({ providers: [provider('live', actions)] });
  try {
    await runtime.execute({ callId: 'first', name: 'set' });
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
    prepare: (call, options) => actions.prepare(call, options),
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
    prepare: (call, options) => actions.prepare(call, options),
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
  const description = { ...source };
  const sourceProvider = createVacpProvider({
    source: description,
    actions: new VacpActionRegistry(),
    project: () => ({ graph, state: {}, summary }),
  });
  const runtime = createVacpRuntime({ providers: [sourceProvider] });
  const titles: string[] = [];
  const summaries: string[] = [];
  const sourceTitles: string[] = [];
  try {
    await runtime.getCapabilities();
    runtime.subscribeCapabilities((value) => {
      titles.push(value.graph.nodes[0]!.title!);
      sourceTitles.push(value.graph.sources[0]!.title);
    });
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
    description.title = 'Renamed source';
    await runtime.getCapabilities();
    assert.equal(sourceTitles.at(-1), 'Renamed source');
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
    const inspected = await runtime.getRuntime();
    assert.equal(inspected.history[0]!.observation!.revision, first.revision);
    assert.equal(inspected.history[0]!.observation!.freshness!['vacp://view'].status, 'current');
    assert.equal(inspected.observation.freshness!['vacp://view'].status, 'stale');
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
    runtime.attachProviders([
      createVacpProvider({
        source: { id: 'vacp-source://unrelated', type: 'test', title: 'Unrelated' },
        actions: new VacpActionRegistry(),
        project: () => ({ graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [] }, state: {} }),
      }),
    ]);
    finish();
    assert.deepEqual(await call, { callId: 'wait', ok: true, result: 'done' });
  } finally {
    finish();
    runtime.dispose();
  }
});

test('recorded observations are isolated from providers, read results, and other subscribers', async () => {
  const graph = {
    version: VACP_SCHEMA_VERSION,
    nodes: [{ ref: 'vacp://view' as const, title: 'first', kind: 'View', layer: 'ViewLayer' }],
    edges: [],
  };
  const state = { 'vacp://view': { value: 1 } };
  const runtime = createVacpRuntime({
    providers: [createVacpProvider({ source, actions: new VacpActionRegistry(), project: () => ({ graph, state }) })],
  });
  const titles: string[] = [];
  runtime.subscribeSnapshots(({ observation }) => {
    observation.graph.nodes[0]!.title = 'subscriber mutation';
  });
  runtime.subscribeSnapshots(({ observation }) => titles.push(observation.graph.nodes[0]!.title!));
  runtime.stopObserving();
  try {
    await runtime.refresh();
    const first = await runtime.getRuntime();
    first.history[0]!.observation!.graph.nodes[0]!.title = 'consumer mutation';
    first.observation.state['vacp://view'] = { value: 99 };
    graph.nodes[0]!.title = 'second';
    state['vacp://view'].value = 2;
    await runtime.refresh();
    const next = await runtime.getRuntime();
    assert.deepEqual(titles, ['first', 'second']);
    assert.equal(next.history[0]!.observation!.graph.nodes[0]!.title, 'first');
    assert.deepEqual(next.history[0]!.observation!.state['vacp://view'], { value: 1 });
    assert.deepEqual(next.history.at(-1)!.observation!.state['vacp://view'], { value: 2 });
  } finally {
    runtime.dispose();
  }
});

test('concurrent reads coalesce and explicit refresh supersedes an older pending observation', async () => {
  const original = provider('original');
  let release!: (value: VacpProviderObservation) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let reads = 0;
  const runtime = createVacpRuntime({
    providers: [
      {
        ...original,
        observe: () => {
          reads++;
          if (reads > 1) return provider('current').observe();
          began();
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    ],
  });
  try {
    const first = runtime.observe();
    const second = runtime.getCapabilities();
    await started;
    assert.equal(reads, 1);
    await runtime.refresh();
    release(await original.observe());
    assert.equal((await first).graph.nodes[0]!.title, 'current');
    assert.equal((await second).graph.nodes[0]!.title, 'current');
    assert.equal((await runtime.getRuntime()).history[0]!.observation!.graph.nodes[0]!.title, 'current');
  } finally {
    runtime.dispose();
  }
});

test('a failed provider replacement preserves the live owner and its subscriptions', async () => {
  let disposed = 0;
  let subscriptions = 0;
  const original: VacpProvider = {
    ...provider('original'),
    subscribe: () => {
      subscriptions++;
      return () => {
        subscriptions--;
      };
    },
    dispose: () => {
      disposed++;
    },
  };
  const replacement: VacpProvider = {
    ...provider('replacement'),
    subscribe: () => {
      throw new Error('Cannot attach');
    },
  };
  const runtime = createVacpRuntime({ providers: [original] });
  try {
    assert.throws(() => runtime.attachProviders([replacement]), /Cannot attach/);
    assert.throws(() => runtime.update({ providers: [replacement] }), /Cannot attach/);
    assert.equal((await runtime.observe()).graph.nodes[0]!.title, 'original');
    assert.equal(subscriptions, 1);
    assert.equal(disposed, 0);
  } finally {
    runtime.dispose();
  }
  assert.equal(subscriptions, 0);
  assert.equal(disposed, 1);
});

test('human invalidations and semantic actions keep distinct history attribution', async () => {
  let value = 1;
  let invalidate = () => {};
  const actions = new VacpActionRegistry();
  actions.register(descriptor('set'), () => {
    value = 3;
    invalidate();
  });
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        source,
        actions,
        project: () => ({
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [{ ref: 'vacp://view', kind: 'View', layer: 'ViewLayer' }],
            edges: [],
          },
          state: { 'vacp://view': value },
        }),
        subscribe: (listener) => {
          invalidate = listener;
          return () => {};
        },
      }),
    ],
  });
  try {
    runtime.subscribe(() => {});
    await runtime.refresh();
    runtime.stopObserving();
    await runtime.getRuntime();
    const changed = () =>
      new Promise<void>((resolve) => {
        const unsubscribe = runtime.subscribe((entry) => {
          if (entry.source !== 'human') return;
          unsubscribe();
          resolve();
        });
      });
    const firstHuman = changed();
    value = 2;
    invalidate();
    await firstHuman;
    assert.equal((await runtime.getRuntime()).history.at(-1)!.state!.state['vacp://view'], 2);
    await runtime.execute({ callId: 'set', name: 'set' });
    assert.deepEqual(
      (await runtime.getRuntime()).history.map((entry) => [entry.kind, entry.source]),
      [
        ['snapshot', 'system'],
        ['snapshot', 'human'],
        ['action', 'agent'],
      ],
    );
    const nextHuman = changed();
    value = 4;
    invalidate();
    await nextHuman;
    const history = (await runtime.getRuntime()).history;
    assert.equal(history.at(-1)!.source, 'human');
    assert.equal(history.at(-1)!.state!.state['vacp://view'], 4);
  } finally {
    runtime.dispose();
  }
});

test('an unsettled provider fails within the composition retry bound', async () => {
  let invalidate = () => {};
  let reads = 0;
  const unstable = provider('unstable');
  const runtime = createVacpRuntime({
    providers: [
      {
        ...unstable,
        subscribe: (listener) => {
          invalidate = listener;
          return () => {};
        },
        observe: () => {
          reads++;
          invalidate();
          return unstable.observe();
        },
      },
    ],
  });
  try {
    await assert.rejects(runtime.observe(), /did not settle/);
    assert.equal(reads, 8);
  } finally {
    runtime.dispose();
  }
});

test('capabilities follow action catalog changes independently of a host projection revision', async () => {
  const actions = new VacpActionRegistry();
  actions.register(descriptor('first'), () => {});
  const runtime = createVacpRuntime({
    providers: [
      createVacpProvider({
        source,
        actions,
        project: () => ({
          revision: 'host-version',
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [{ ref: 'vacp://view', kind: 'View', layer: 'ViewLayer' }],
            edges: [],
          },
          state: {},
        }),
      }),
    ],
  });
  const catalogs: string[][] = [];
  runtime.subscribeCapabilities((capabilities) =>
    catalogs.push(capabilities.graph.actions.map((action) => action.name)),
  );
  runtime.stopObserving();
  try {
    await runtime.getCapabilities();
    actions.register(descriptor('second'), () => {});
    await runtime.getCapabilities();
    actions.unregister('first');
    await runtime.getCapabilities();
    assert.deepEqual(catalogs, [['first'], ['first', 'second'], ['second']]);
  } finally {
    runtime.dispose();
  }
});
