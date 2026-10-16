import assert from 'node:assert/strict';
import test from 'node:test';
import { pairedDelta, wilson } from '../src/core/stats';
import { cost } from '../src/core/usage';

test('the pass-rate interval stays in [0, 1] and narrows with more runs', () => {
  const small = wilson(10, 10);
  assert.equal(small.hi, 1);
  assert.ok(small.lo > 0.6 && small.lo < 0.8);
  const wide = wilson(15, 30);
  const narrow = wilson(150, 300);
  assert.ok(narrow.hi - narrow.lo < wide.hi - wide.lo);
});

test('a paired delta is significant only when its interval over cases excludes zero', () => {
  const baseline = new Map(Array.from({ length: 12 }, (_, index) => [`case-${index}`, 0.5]));
  const better = new Map([...baseline].map(([id], index) => [id, index < 10 ? 1 : 0.5]));
  const noisy = new Map([...baseline].map(([id], index) => [id, index % 2 ? 1 : 0]));
  assert.equal(pairedDelta(better, baseline).significant, true);
  assert.equal(pairedDelta(noisy, baseline).significant, false);
});

test('cost bills cache reads and writes at their own rates, and is unknown without a price', () => {
  const usage = { input: 1_000_000, output: 100_000, cache_read: 2_000_000, cache_write: 400_000 };
  assert.equal(cost(usage, { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 }), 2 + 1 + 0.4 + 1);
  assert.equal(cost(usage, undefined), undefined);
});
