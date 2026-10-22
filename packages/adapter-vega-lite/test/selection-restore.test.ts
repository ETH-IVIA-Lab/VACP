import assert from 'node:assert/strict';
import test from 'node:test';
import { View, parse, changeset } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { vacpAgentActor } from '@ethivia/vacp-protocol';
import { createVegaLiteProvider } from '../src/index';
import type { VegaViewLike } from '../src/types';

const context = { actor: vacpAgentActor };

const rows = [
  { weather: 'rain', temp: 10 },
  { weather: 'rain', temp: 20 },
  { weather: 'sun', temp: 10 },
  { weather: 'sun', temp: 20 },
];
async function fixture(resolve: 'global' | 'intersect' = 'global') {
  const spec: TopLevelSpec = {
    data: { values: structuredClone(rows) },
    vconcat: [
      {
        name: 'source',
        params: [
          { name: 'pick', select: { type: 'point', fields: ['weather', 'temp'], resolve } },
          { name: 'brush', select: { type: 'interval', encodings: ['x'] } },
        ],
        mark: 'point',
        encoding: { x: { field: 'temp', type: 'quantitative' }, y: { field: 'weather', type: 'nominal' } },
      },
      {
        name: 'filtered',
        transform: [{ filter: { param: 'pick' } }],
        mark: 'point',
        encoding: { x: { field: 'temp', type: 'quantitative' }, y: { field: 'weather', type: 'nominal' } },
      },
    ],
  };
  const compiled = compile(spec).spec;
  const selected = compiled.data?.find(
    (dataset) =>
      'transform' in dataset &&
      dataset.transform?.some(
        (transform) => transform.type === 'filter' && String(transform.expr).includes('pick_store'),
      ),
  );
  assert.ok(selected);
  const view: VegaViewLike = new View(parse(compiled), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    vgSpec: compile(spec).spec,
    options: { appId: 'test', viewId: 'restore', vizId: 'point' },
  });
  const ref = 'vacp://test/restore/point/param/pick';
  const execute = async (name: string, params: unknown) => {
    const descriptor = (await provider.observe()).graph.actions.find((action) => action.operation.contract === name);
    assert.ok(descriptor);
    const prepared = await provider.prepare({ callId: name, name: descriptor.name, params });
    const result = await prepared.execute(context);
    assert.equal(result.ok, true);
  };
  return {
    provider,
    view,
    ref,
    execute,
    selected: () =>
      view
        .data(selected.name)
        .map((row: { weather: string; temp: number }) => ({ weather: row.weather, temp: row.temp })),
    dispose: () => {
      provider.dispose?.();
      view.finalize();
    },
  };
}

test('resolved point values restore correlated tuples and native filtered marks without marginal expansion', async () => {
  const f = await fixture();
  try {
    const values = [rows[0], rows[3]];
    await f.execute('vega_lite.set_selection', { ref: f.ref, value: values });
    const value = structuredClone(f.view.signal('pick'));
    const snapshot = (await f.provider.observe()).state;
    assert.deepEqual(f.selected(), values);
    await f.execute('vega_lite.set_selection', { ref: f.ref, value: rows[1] });
    await f.execute('vega_lite.set_selection', { ref: f.ref, value });
    assert.deepEqual(f.view.signal('pick'), value);
    assert.deepEqual(f.selected(), values);
    await f.execute('vega_lite.clear_selection', { ref: f.ref });
    await f.execute('vacp.apply_state', { state: snapshot });
    assert.deepEqual(f.view.signal('pick'), value);
    assert.deepEqual(f.selected(), values);
  } finally {
    f.dispose();
  }
});

test('captured native tuples preserve intersected unit identity during restoration', async () => {
  const f = await fixture('intersect');
  try {
    const fields = [
      { type: 'E', field: 'weather' },
      { type: 'E', field: 'temp' },
    ];
    f.view.change(
      'pick_store',
      changeset().insert([
        { unit: 'source', fields, values: ['rain', [10, 20]] },
        { unit: 'another-view', fields, values: [['rain', 'sun'], 20] },
      ]),
    );
    await f.view.runAsync();
    const value = structuredClone(f.view.signal('pick'));
    const snapshot = (await f.provider.observe()).state;
    assert.deepEqual(f.selected(), [rows[1]]);
    await f.execute('vega_lite.clear_selection', { ref: f.ref });
    await f.execute('vacp.apply_state', { state: snapshot });
    assert.deepEqual(f.view.signal('pick'), value);
    assert.deepEqual(f.selected(), [rows[1]]);
    assert.deepEqual(
      f.view.data('pick_store').map((tuple: { unit: string }) => tuple.unit),
      ['source', 'another-view'],
    );
  } finally {
    f.dispose();
  }
});

test('state restoration publishes one native evaluation with both point and interval selections applied', async () => {
  const f = await fixture();
  const brush = f.ref.replace('/pick', '/brush');
  try {
    await f.execute('vega_lite.set_selection', { ref: f.ref, value: rows[0] });
    await f.execute('vega_lite.set_selection', { ref: brush, value: { x: [5, 15] } });
    const state = (await f.provider.observe()).state;
    const expected = {
      point: structuredClone(f.view.signal('pick')),
      interval: structuredClone(f.view.signal('brush')),
    };
    await f.execute('vega_lite.set_selection', { ref: f.ref, value: rows[3] });
    await f.execute('vega_lite.set_selection', { ref: brush, value: { x: [15, 25] } });
    const completed: unknown[] = [];
    const run = f.view.runAsync;
    f.view.runAsync = async function (...args) {
      const result = await run.apply(this, args);
      completed.push({ point: structuredClone(this.signal('pick')), interval: structuredClone(this.signal('brush')) });
      return result;
    };
    await f.execute('vacp.apply_state', { state });
    assert.deepEqual(completed, [expected]);
  } finally {
    f.dispose();
  }
});

test('a failed native evaluation reports failure after one mutation attempt', async () => {
  const f = await fixture();
  const native = f.view.runAsync;
  let evaluations = 0;
  try {
    const action = (await f.provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_selection',
    )!;
    const prepared = await f.provider.prepare({
      callId: 'failure',
      name: action.name,
      params: { ref: f.ref.replace('/pick', '/brush'), value: { x: [5, 15] } },
    });
    f.view.runAsync = async function (_encode?: string | null, before?: (view: VegaViewLike) => void) {
      evaluations++;
      before?.(this);
      throw new Error('native render failed');
    };
    const result = await prepared.execute(context);
    assert.equal(result.ok, false);
    assert.equal(evaluations, 1);
  } finally {
    f.view.runAsync = native;
    f.dispose();
  }
});
