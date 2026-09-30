import assert from 'node:assert/strict';
import test from 'node:test';
import { equals } from '../src/core/assertions';
import { state } from '../src/core/checks';
import { definePage, defineScenario } from '../src/core/scenario';
import { drawSplit } from '../src/core/split';

const page = definePage({ id: 'page', path: '/', title: 'Page' });
const scenario = (id: string, capability: string) =>
  defineScenario({
    id,
    page,
    tags: [capability],
    source: 'synthesized',
    why: 'Fixture.',
    turns: [{ say: 'Do it.', expect: [state('vacp://x', '', equals(1))], oracle: { answer: 'Done.' } }],
  });
const scenarios = [
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => scenario(`filter-${id}`, 'filter')),
  ...['a', 'b', 'c'].map((id) => scenario(`point-${id}`, 'point')),
];

test('the split is stratified by capability, disjoint, complete, and fixed by its seed', () => {
  const split = drawSplit(scenarios, 7);
  assert.deepEqual(drawSplit(scenarios, 7), split);
  assert.equal(split.test.filter((id) => id.startsWith('filter')).length, 2);
  assert.equal(split.test.filter((id) => id.startsWith('point')).length, 1);
  assert.deepEqual([...split.train, ...split.test].sort(), scenarios.map((each) => each.id).sort());
  assert.notDeepEqual(drawSplit(scenarios, 8).test, split.test);
});
