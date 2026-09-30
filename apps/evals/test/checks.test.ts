import assert from 'node:assert/strict';
import test from 'node:test';
import { equals } from '../src/core/assertions';
import {
  mentions,
  numbersIn,
  range,
  readOnly,
  restored,
  sameMembers,
  state,
  unchanged,
  within,
} from '../src/core/checks';
import type { Check, CheckContext, ExecutionRecord } from '../src/core/scenario';

const context = (overrides: Partial<CheckContext> = {}): CheckContext => ({
  reply: '',
  state: {},
  before: {},
  initial: {},
  text: async () => null,
  executions: [],
  ...overrides,
});

async function passes(check: Check, overrides: Partial<CheckContext>) {
  const evaluation = await check.assertion.evaluate(await check.read(context(overrides)));
  return evaluation.score === 1;
}

test('numbers in prose drop thousands separators and read range hyphens as separators, not signs', () => {
  assert.deepEqual(
    numbersIn('2,521 athletes aged 18-25, a 26.3% share, from -161 to 414 over 1,000,000 rides'),
    [2521, 18, 25, 26.3, -161, 414, 1000000],
  );
  assert.deepEqual(numbersIn('ages 18–25, readings from −161 to 414'), [18, 25, -161, 414]);
});

test('an answer mentions a number within tolerance, or any spelling of a name', async () => {
  assert.equal(await passes(mentions(26.3, { tolerance: 0.1 }), { reply: 'Gymnastics leads at 26.32% of 114.' }), true);
  assert.equal(await passes(mentions(26.3, { tolerance: 0.1 }), { reply: 'Gymnastics leads at 25.4%.' }), false);
  assert.equal(await passes(mentions(['ATL', 'Atlanta']), { reply: 'ATLANTA has the most routes.' }), true);
  assert.equal(await passes(mentions(5606), { reply: 'There are **4,513 flights**.' }), false);
});

test('answers match through typographic apostrophes and dashes, and by pattern', async () => {
  const reply = 'I couldn’t apply the filter: the dashboard doesn’t expose nationality, ages 18–25 only.';
  assert.equal(await passes(mentions("doesn't expose"), { reply }), true);
  assert.equal(await passes(mentions('18-25'), { reply }), true);
  assert.equal(await passes(mentions(/\bcouldn't\b/), { reply }), true);
  assert.equal(await passes(mentions(/\bcannot\b/), { reply }), false);
});

test('state checks read dotted paths into the ref after the turn', async () => {
  const ref = 'vacp://app/cohort';
  const after = { [ref]: { count: 39, age: [25, 18], sports: ['gymnastics', 'aquatics'] } };
  assert.equal(await passes(state(ref, 'count', equals(39)), { state: after }), true);
  assert.equal(await passes(state(ref, 'age', range([18, 25])), { state: after }), true);
  assert.equal(await passes(state(ref, 'sports', sameMembers(['Aquatics', 'gymnastics'])), { state: after }), true);
  assert.equal(await passes(state(ref, 'age.0', within(18, 20)), { state: after }), false);
  assert.equal(await passes(state(ref, 'missing', equals(1)), { state: after }), false);
});

test('unchanged compares a turn with its start, restored compares it with the run start', async () => {
  const ref = 'vacp://app/cohort';
  const secondTurn = {
    initial: { [ref]: { count: 1 } },
    before: { [ref]: { count: 2 } },
    state: { [ref]: { count: 2 } },
  };
  assert.equal(await passes(unchanged(ref, 'count'), secondTurn), true);
  assert.equal(await passes(restored(ref, 'count'), secondTurn), false);
  const undone = { ...secondTurn, state: { [ref]: { count: 1 } } };
  assert.equal(await passes(unchanged(ref), undone), false);
  assert.equal(await passes(restored(ref), undone), true);
});

const execution = (operation: ExecutionRecord['operation'], phase: ExecutionRecord['phase']): ExecutionRecord => ({
  id: `${operation}-${phase}`,
  name: `chart.${operation ?? 'custom'}`,
  operation,
  actor: 'agent',
  phase,
  phases: [],
});

test('read only allows reads and queries, and fails on any other change the agent completed', async () => {
  const reads = [
    execution('evaluation', 'succeeded'),
    execution('query', 'succeeded'),
    execution('mutation', 'failed'),
  ];
  assert.equal(await passes(readOnly(), { executions: reads }), true);
  for (const change of [
    execution('mutation', 'succeeded'),
    execution('creation', 'succeeded'),
    execution(undefined, 'succeeded'),
  ])
    assert.equal(await passes(readOnly(), { executions: [...reads, change] }), false, String(change.operation));
});

test('state compared before and after a turn ignores the order of object keys', async () => {
  const ref = 'vacp://app/cohort';
  assert.equal(
    await passes(unchanged(ref), { before: { [ref]: { a: 1, b: 2 } }, state: { [ref]: { b: 2, a: 1 } } }),
    true,
  );
});
