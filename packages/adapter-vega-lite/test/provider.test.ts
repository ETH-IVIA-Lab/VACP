import assert from 'node:assert/strict';
import test from 'node:test';
import { createVegaLiteProvider, type VegaViewLike } from '../src/index';

test('provider observation preserves native tooltip behavior and releases listeners across rebinding', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = new Map<string, () => void>();
  const events = new Map<string, (event: Event, item?: unknown) => void>();
  const originalTooltip = () => {};
  let tooltip = originalTooltip;
  let value = 1;
  const view: VegaViewLike = {
    signal: (_name, next) => (next === undefined ? value : (value = next)),
    runAsync: async () => {},
    addSignalListener: (name, listener) => signals.set(name, () => listener(name, value)),
    removeSignalListener: (name) => {
      signals.delete(name);
    },
    tooltip: (next) => (next ? (tooltip = next) : tooltip),
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name) => {
      events.delete(name);
    },
  };
  const create = () =>
    createVegaLiteProvider({
      view,
      spec: { params: [{ name: 'threshold', value: 1 }], mark: { type: 'point', tooltip: true } },
      options: { appId: 'test', viewId: 'overview', vizId: 'scatter', enableDuckDbDataHandle: false },
    });
  const first = create();
  assert.equal(signals.size, 0);
  let firstChanges = 0;
  const detach = first.subscribe!(() => firstChanges++);
  assert.equal(tooltip, originalTooltip);
  assert.equal(events.size, 2);
  signals.get('threshold')!();
  detach();
  t.mock.timers.tick(120);
  assert.equal(firstChanges, 0);
  assert.equal(events.size, 0);
  assert.equal(signals.size, 0);
  assert.equal(tooltip, originalTooltip);
  first.dispose!();
  const second = create();
  let secondChanges = 0;
  second.subscribe!(() => secondChanges++);
  events.get('pointermove')!(new Event('pointermove'), { tooltip: { value: 2 }, datum: { value: 2 } });
  t.mock.timers.tick(120);
  assert.equal(secondChanges, 1);
  second.dispose!();
  assert.equal(signals.size, 0);
  assert.equal(tooltip, originalTooltip);
});

test('two charts compose with distinct operation ownership and independent controls', async () => {
  const { createVacpRuntime } = await import('@vacp/runtime');
  const chart = (vizId: string) => {
    let threshold = 0;
    const view: VegaViewLike = {
      signal: (_name, next) => (next === undefined ? threshold : (threshold = next)),
      runAsync: async () => {},
    };
    return {
      value: () => threshold,
      provider: createVegaLiteProvider({
        view,
        spec: { params: [{ name: 'threshold', value: 0 }], mark: 'point' },
        options: { appId: 'test', viewId: 'dashboard', vizId, enableDuckDbDataHandle: false },
      }),
    };
  };
  const first = chart('first');
  const second = chart('second');
  const runtime = createVacpRuntime({ providers: [first.provider, second.provider] });
  try {
    const observation = await runtime.observe();
    const operations = observation.graph.actions.filter(
      (action) => action.operation.contract === 'vega_lite.set_param',
    );
    assert.equal(operations.length, 2);
    assert.notEqual(operations[0].name, operations[1].name);
    const operation = operations.find(
      (action) => observation.graph.ownership.actions[action.name] === second.provider.source.id,
    );
    assert.ok(operation);
    const result = await runtime.execute({
      callId: 'set-second',
      name: operation.name,
      params: { ref: 'vacp://test/dashboard/second/param/threshold', value: 42 },
    });
    assert.equal(result.ok, true);
    assert.equal(first.value(), 0);
    assert.equal(second.value(), 42);
    const firstOperation = operations.find((action) => action.name !== operation.name)!;
    const foreignTarget = await runtime.execute({
      callId: 'foreign-target',
      name: firstOperation.name,
      params: { ref: 'vacp://test/dashboard/second/param/threshold', value: 99 },
    });
    assert.equal(foreignTarget.ok, false);
    assert.equal(first.value(), 0);
    assert.equal(second.value(), 42);
  } finally {
    runtime.dispose();
  }
});

test('failed observation binding releases partial listeners and remains retryable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const listeners = new Map<string, () => void>();
  let fail = true;
  const view: VegaViewLike = {
    signal: () => 0,
    runAsync: async () => {},
    addSignalListener: (name, listener) => {
      if (name === 'second' && fail) throw new Error('binding failed');
      listeners.set(name, () => listener(name, 0));
    },
    removeSignalListener: (name) => {
      listeners.delete(name);
    },
  };
  const provider = createVegaLiteProvider({
    view,
    spec: { params: [{ name: 'first' }, { name: 'second' }] },
    options: { appId: 'test', viewId: 'failure', vizId: 'chart', enableDuckDbDataHandle: false },
  });
  assert.throws(() => provider.subscribe!(() => {}), /binding failed/);
  assert.equal(listeners.size, 0);
  fail = false;
  provider.subscribe!(() => {
    throw new Error('consumer failed');
  });
  let changes = 0;
  provider.subscribe!(() => changes++);
  listeners.get('first')!();
  t.mock.timers.tick(120);
  assert.equal(changes, 1);
  provider.dispose!();
  assert.equal(listeners.size, 0);
});

test('shared view observation preserves native promise identity and other consumers on detach', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let value: unknown = 1;
  const result = Promise.resolve();
  const runAsync = () => result;
  const view: VegaViewLike = { signal: (_name, next) => (next === undefined ? value : (value = next)), runAsync };
  const create = () =>
    createVegaLiteProvider({
      view,
      spec: { params: [{ name: 'threshold', value: 1 }] },
      options: { appId: 'test', viewId: 'shared', vizId: 'chart', enableDuckDbDataHandle: false },
    });
  const first = create(),
    second = create();
  first.subscribe!(() => {});
  const wrapped = view.runAsync;
  second.subscribe!(() => {});
  assert.equal(view.runAsync, wrapped);
  first.dispose!();
  assert.equal(view.runAsync, wrapped);
  assert.equal(view.runAsync(), result);
  await result;
  t.mock.timers.tick(120);
  assert.equal(Object.values((await second.observe()).freshness ?? {})[0]?.status, 'current');
  second.dispose!();
  assert.equal(view.runAsync, runAsync);
});

test('raw signal preparation resolves the native target and retains caller values before execution', async () => {
  let current: unknown = 1;
  const view: VegaViewLike = {
    signal(name, value) {
      if (name !== 'threshold') throw new Error('Unknown signal');
      if (arguments.length === 2) current = value;
      return current;
    },
    runAsync: async () => {},
  };
  const provider = createVegaLiteProvider({
    view,
    spec: {},
    options: {
      appId: 'test',
      viewId: 'prepared',
      vizId: 'chart',
      includeSetSignalAction: true,
      enableDuckDbDataHandle: false,
    },
  });
  try {
    const action = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega.set_signal',
    )!;
    await assert.rejects(
      provider.prepare({ callId: 'invalid', name: action.name, params: { name: 'missing', value: 2 } }),
      /Unknown signal/,
    );
    const params = { name: 'threshold', value: { level: 2 } };
    const plan = await provider.prepare({ callId: 'valid', name: action.name, params });
    params.value.level = 9;
    assert.equal(current, 1);
    assert.equal((await plan.execute()).ok, true);
    assert.deepEqual(current, { level: 2 });
  } finally {
    provider.dispose?.();
  }
});

test('parameter observations share a native snapshot while preserving scoped signal fallback', async () => {
  let revision = 0;
  let unavailable = false;
  const view: VegaViewLike = {
    signal: (name) => (name === 'outside' ? 42 : 100),
    getState: () => {
      if (unavailable) throw new Error('Snapshot unavailable');
      const value = ++revision;
      return {
        signals: { first: value },
        subcontext: { unit: { signals: { first: -1, second: value, outside: null } } },
      };
    },
    runAsync: async () => {},
  };
  const provider = createVegaLiteProvider({
    view,
    spec: { params: ['first', 'second', 'outside'].map((name) => ({ name, value: 0 })) },
    options: { appId: 'test', viewId: 'coherent', vizId: 'chart', enableDuckDbDataHandle: false },
  });
  const values = async () => {
    const { state } = await provider.observe();
    return ['first', 'second', 'outside'].map(
      (name) => (state[`vacp://test/coherent/chart/param/${name}`] as { value: number }).value,
    );
  };
  try {
    const [first, second, outside] = await values();
    assert.ok(first > 0);
    assert.equal(first, second);
    assert.equal(outside, 42);
    unavailable = true;
    assert.deepEqual(await values(), [100, 100, 42]);
  } finally {
    provider.dispose?.();
  }
});
