import assert from 'node:assert/strict';
import test from 'node:test';
import { equals, satisfies } from '../src/core/assertions';
import { mentions, readOnly, state } from '../src/core/checks';
import { gradeTurn, summarize, type GradingRecord } from '../src/core/grade';
import { definePage, defineScenario, type Check } from '../src/core/scenario';

const ref = 'vacp://app/cohort';
const page = definePage({ id: 'page', path: '/', title: 'Page' });
const scenario = (expect: Check[]) =>
  defineScenario({
    id: 'page/count',
    page,
    tags: ['count'],
    source: 'synthesized',
    why: 'Fixture.',
    turns: [{ say: 'How many?', expect, oracle: { answer: '39.' } }],
  });
const record: GradingRecord = {
  initial: {},
  turns: [{ reply: 'There are 39 athletes.', state: { [ref]: { count: 65 } }, executions: [], texts: {} }],
};
const noText = async () => null;

test('pass requires every gate, and each check kind gets its own metric with the failure explained', async () => {
  const results = await gradeTurn(scenario([state(ref, 'count', equals(39)), mentions(39)]), record, 0, noText);
  const { grade, explanation } = summarize(results);
  assert.deepEqual(grade, { pass: 0, state: 0, answer: 1, guard: null });
  assert.match(explanation.state!, /turn 1 · cohort\.count equals: observed 65/);
  assert.equal(explanation.answer, undefined);
});

test('soft checks are tracked as their own metric and never decide pass', async () => {
  const soft: Check = {
    kind: 'answer',
    label: 'names the sport',
    assertion: satisfies<string>((reply) => /gymnast|swimm/i.test(reply)).soft(),
    read: (context) => context.reply,
  };
  const { grade } = summarize(await gradeTurn(scenario([mentions(39), soft, readOnly()]), record, 0, noText));
  assert.equal(grade.pass, 1);
  assert.equal(grade.guard, 1);
  assert.equal(grade['soft:names the sport'], 0);
});

test('a soft check’s label names one metric per scenario, while gates may repeat across turns', () => {
  const twice = (expect: () => Check) => () =>
    defineScenario({
      id: 'page/twice',
      page,
      tags: ['count'],
      source: 'synthesized',
      why: 'Fixture.',
      turns: [
        { say: 'First.', expect: [expect()], oracle: { answer: '1.' } },
        { say: 'Second.', expect: [expect()], oracle: { answer: '1.' } },
      ],
    });
  assert.doesNotThrow(twice(() => mentions(1)));
  const soft = (): Check => ({ ...mentions(1), assertion: mentions(1).assertion.soft() });
  assert.throws(twice(soft), /repeats the soft check "mentions 1"/);
});
