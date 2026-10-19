import assert from 'node:assert/strict';
import test from 'node:test';
import { View, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVacpRuntime, executeVacpAction } from '@ethivia/vacp-runtime';
import { createVegaLiteProvider } from '../src/index';
import type { VegaViewLike } from '../src/types';

async function chart(vizId = 'chart') {
  const spec: TopLevelSpec = {
    data: { values: [{ x: 1 }, { x: 2 }] },
    params: [{ name: 'threshold', value: 1 }],
    mark: 'point',
    encoding: { x: { field: 'x', type: 'quantitative' } },
  };
  const vgSpec = compile(spec).spec;
  const view: VegaViewLike = new View(parse(vgSpec), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    vgSpec,
    options: { appId: 'test', viewId: 'dashboard', vizId },
  });
  return { view, provider, ref: `vacp://test/dashboard/${vizId}/param/threshold` as const };
}

test('native parameter changes invalidate subscribers and detach releases observation', async () => {
  const f = await chart();
  let changes = 0;
  const detach = f.provider.subscribe!(() => changes++);
  try {
    f.view.signal('threshold', 42);
    await f.view.runAsync();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const state = (await f.provider.observe()).state[f.ref];
    assert.ok(state && typeof state === 'object' && 'value' in state);
    assert.equal(state.value, 42);
    assert.ok(changes > 0);
    detach();
    const before = changes;
    f.view.signal('threshold', 7);
    await f.view.runAsync();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(changes, before);
  } finally {
    f.provider.dispose!();
    f.view.finalize();
  }
});

test('two charts compose with distinct operation ownership and independent native controls', async () => {
  const first = await chart('first');
  const second = await chart('second');
  const runtime = createVacpRuntime({ providers: [first.provider, second.provider] });
  try {
    const observation = await runtime.observe();
    const operations = observation.graph.actions.filter(
      (action) => action.operation.contract === 'vega_lite.set_param',
    );
    assert.equal(operations.length, 2);
    const operation = operations.find(
      (action) => observation.graph.ownership.actions[action.name] === second.provider.source.id,
    )!;
    const result = await runtime.execute({
      callId: 'second',
      name: operation.name,
      params: { ref: second.ref, value: 42 },
    });
    assert.equal(result.ok, true);
    assert.equal(first.view.signal('threshold'), 1);
    assert.equal(second.view.signal('threshold'), 42);
  } finally {
    runtime.dispose();
    first.view.finalize();
    second.view.finalize();
  }
});

test('prepared parameter values are isolated and invalid refs fail before mutation', async () => {
  const f = await chart();
  try {
    const action = (await f.provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_param',
    )!;
    await assert.rejects(
      f.provider.prepare({ callId: 'invalid', name: action.name, params: { ref: 'vacp://missing/param', value: 9 } }),
      /Unknown parameter reference/,
    );
    const params = { ref: f.ref, value: { level: 2 } };
    const prepared = await f.provider.prepare({ callId: 'valid', name: action.name, params });
    params.value.level = 9;
    assert.equal(f.view.signal('threshold'), 1);
    assert.equal((await prepared.execute()).ok, true);
    assert.deepEqual(f.view.signal('threshold'), { level: 2 });
  } finally {
    f.provider.dispose!();
    f.view.finalize();
  }
});

test('a provider without a data port executes parameter actions', async () => {
  const f = await chart();
  try {
    const observation = await f.provider.observe();
    assert.equal(observation.graph.nodes.filter((node) => node.kind === 'DataHandle').length, 0);
    const action = observation.graph.actions.find((action) => action.operation.contract === 'vega_lite.set_param')!;
    assert.equal(
      (await executeVacpAction(f.provider, { callId: 'set', name: action.name, params: { ref: f.ref, value: 5 } })).ok,
      true,
    );
    assert.equal(f.view.signal('threshold'), 5);
  } finally {
    f.provider.dispose!();
    f.view.finalize();
  }
});

test('native evaluation observation preserves promise identity and releases the borrowed view', async () => {
  const spec: TopLevelSpec = { data: { values: [{ x: 1 }] }, mark: 'point' };
  const vgSpec = compile(spec).spec;
  const view: VegaViewLike = new View(parse(vgSpec), { renderer: 'none' });
  await view.runAsync();
  const run = view.runAsync;
  let nativePromise: Promise<View> | undefined;
  const hostRun: VegaViewLike['runAsync'] = (...args) => {
    nativePromise = run.apply(view, args);
    return nativePromise;
  };
  view.runAsync = hostRun;
  const provider = createVegaLiteProvider({
    view,
    spec,
    vgSpec,
    options: { appId: 'test', viewId: 'promise', vizId: 'chart' },
  });
  const detach = provider.subscribe!(() => {});
  try {
    assert.equal(view.runAsync(), nativePromise);
    await nativePromise;
    detach();
    assert.equal(view.runAsync, hostRun);
    provider.dispose!();
    await view.runAsync();
    assert.equal(view.data('source_0').length, 1);
  } finally {
    detach();
    provider.dispose!();
    view.finalize();
  }
});
