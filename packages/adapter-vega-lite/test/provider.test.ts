import assert from 'node:assert/strict';
import test from 'node:test';
import { createVegaLiteProvider, type VegaViewLike } from '../src/index';

test('provider observation subscriptions release signal and tooltip ownership across rebinding', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = new Map<string, () => void>();
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
  assert.notEqual(tooltip, originalTooltip);
  signals.get('threshold')!();
  detach();
  t.mock.timers.tick(120);
  assert.equal(firstChanges, 0);
  assert.equal(signals.size, 0);
  assert.equal(tooltip, originalTooltip);
  first.dispose!();
  const second = create();
  let secondChanges = 0;
  second.subscribe!(() => secondChanges++);
  signals.get('threshold')!();
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
