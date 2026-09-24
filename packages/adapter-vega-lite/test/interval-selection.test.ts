import assert from 'node:assert/strict';
import test from 'node:test';
import { View, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '../src/index';

const athletes = [
  { weight: 60, height: 1.7 },
  { weight: 72, height: 1.91 },
  { weight: 84, height: 1.94 },
  { weight: 90, height: 1.85 },
];

async function brushFixture() {
  const spec: TopLevelSpec = {
    data: { values: structuredClone(athletes) },
    vconcat: [
      {
        params: [{ name: 'body', select: { type: 'interval', encodings: ['x', 'y'] } }],
        mark: 'point',
        encoding: {
          x: { field: 'weight', type: 'quantitative' },
          y: { field: 'height', type: 'quantitative', scale: { zero: false } },
        },
      },
      {
        name: 'selected',
        transform: [{ filter: { param: 'body' } }],
        mark: 'point',
        encoding: { x: { field: 'weight', type: 'quantitative' }, y: { field: 'height', type: 'quantitative' } },
      },
    ],
  };
  const compiled = compile(spec).spec;
  const filtered = compiled.data?.find(
    (dataset) =>
      'transform' in dataset &&
      dataset.transform?.some(
        (transform) => transform.type === 'filter' && String(transform.expr).includes('body_store'),
      ),
  );
  assert.ok(filtered);
  const view = new View(parse(compiled), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    options: { appId: 'test', viewId: 'physique', vizId: 'body', enableDuckDbDataHandle: false },
  });
  const select = async (value: unknown) => {
    const descriptor = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_selection',
    );
    assert.ok(descriptor);
    const prepared = await provider.prepare({
      callId: 'select',
      name: descriptor.name,
      params: { ref: 'vacp://test/physique/body/param/body', value },
    });
    return prepared.execute();
  };
  return {
    view,
    select,
    heights: () => view.data(filtered.name).map((row: { height: number }) => row.height),
    dispose: () => {
      provider.dispose?.();
      view.finalize();
    },
  };
}

test('an interval given for one channel of a two-channel brush spans the other channel’s axis', async () => {
  const f = await brushFixture();
  try {
    const result = await f.select({ y: [1.9, 2.25] });
    assert.equal(result.ok, true);
    const value = f.view.signal('body') as { weight?: number[]; height?: number[] };
    assert.deepEqual(value.height, [1.9, 2.25]);
    assert.deepEqual(value.weight, f.view.scale('concat_0_x').domain());
    assert.deepEqual(f.heights().sort(), [1.91, 1.94]);
  } finally {
    f.dispose();
  }
});

test('a range that is not two numbers is rejected before the brush changes', async () => {
  const f = await brushFixture();
  try {
    assert.equal((await f.select({ y: [1.9, 2.25] })).ok, true);
    await assert.rejects(f.select({ y: ['tall', 'taller'] }), /y \(height\) as \[min, max\] numbers or dates/);
    assert.deepEqual((f.view.signal('body') as { height?: number[] }).height, [1.9, 2.25]);
    assert.deepEqual(f.heights().sort(), [1.91, 1.94]);
  } finally {
    f.dispose();
  }
});
