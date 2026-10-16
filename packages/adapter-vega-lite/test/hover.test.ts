import assert from 'node:assert/strict';
import test from 'node:test';
import { View, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '../src/index';

test('a hover that matches no mark lists the named marks and their fields, and their name matches', async () => {
  const spec: TopLevelSpec = {
    data: {
      values: [
        { name: 'Ann', score: 3 },
        { name: 'Ben', score: 5 },
      ],
    },
    mark: { type: 'point', tooltip: true },
    encoding: { x: { field: 'name', type: 'nominal' }, y: { field: 'score', type: 'quantitative' } },
  };
  const view = new View(parse(compile(spec).spec), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    vgSpec: compile(spec).spec,
    options: { appId: 'test', viewId: 'scores', vizId: 'chart' },
  });
  const hover = async (params: unknown) => {
    const descriptor = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.hover_tooltip',
    );
    assert.ok(descriptor);
    const outcome = await (await provider.prepare({ callId: 'hover', name: descriptor.name, params })).execute();
    assert.equal(outcome.ok, true);
    return outcome.result as {
      matches: number;
      marks?: Array<{ name: string; type: string; items: number; fields: string[] }>;
    };
  };
  try {
    const miss = await hover({ fields: { name: 'Ann' }, markName: 'circle' });
    assert.equal(miss.matches, 0);
    const [mark] = miss.marks ?? [];
    assert.equal(mark?.type, 'symbol');
    assert.equal(mark?.items, 2);
    assert.ok(mark?.fields.includes('name'));
    const hit = await hover({ fields: { name: 'Ann' }, markName: mark!.name });
    assert.equal(hit.matches, 1);
    assert.equal(hit.marks, undefined);
  } finally {
    provider.dispose?.();
    view.finalize();
  }
});
