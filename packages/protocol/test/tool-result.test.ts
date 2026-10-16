import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { VACP_TOOL_RESULT_LIMITS, vacpToolResult } from '../src/index';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tool-result.json', import.meta.url), 'utf8'));

test('every transport bounds tool results to the same limits', () => {
  assert.deepEqual(VACP_TOOL_RESULT_LIMITS, fixture.limits);
});

test('a tool result keeps what fits and says what it cut, as every transport cuts it', () => {
  for (const { name, input, expected } of fixture.cases)
    assert.deepEqual(vacpToolResult(input, fixture.caseLimits), expected, name);
});

test('a bounded result passes through unchanged, so its counts survive a second pass', () => {
  for (const { name, expected } of fixture.cases)
    assert.deepEqual(vacpToolResult(expected, fixture.caseLimits), expected, name);
});

test('native values read as the JSON they stand for', () => {
  const at = new Date('2026-03-05T12:34:56.000Z');
  const looped: Record<string, unknown> = { at };
  looped.self = looped;
  const lazy = (): unknown => ({ toJSON: lazy });
  assert.deepEqual(
    vacpToolResult({
      at,
      invalid: new Date('not a date'),
      big: 42n,
      skipped: undefined,
      call: () => {},
      holes: [undefined, 1],
      bytes: new Uint8Array([1, 2]).buffer,
      ratios: new Float64Array([1.5, 2]),
      tags: new Set(['a']),
      byName: new Map([[1, 'one']]),
      failure: new Error('boom', { cause: 'offline' }),
      ratio: Number.NaN,
      money: { toJSON: () => '12.50 CHF' },
      lazy: lazy(),
      __proto__key: JSON.parse('{"__proto__": 1}'),
      looped,
    }),
    {
      at: '2026-03-05T12:34:56.000Z',
      invalid: null,
      big: '42',
      holes: [null, 1],
      bytes: [1, 2],
      ratios: [1.5, 2],
      tags: ['a'],
      byName: { 1: 'one' },
      failure: { name: 'Error', message: 'boom', cause: 'offline' },
      ratio: 'NaN',
      money: '12.50 CHF',
      lazy: {},
      __proto__key: JSON.parse('{"__proto__": 1}'),
      looped: { at: '2026-03-05T12:34:56.000Z', self: '[circular]' },
    },
  );
});

test('a value reached twice without a loop reads in full both times', () => {
  const shared = { n: 1 };
  const row = [1, 2];
  assert.deepEqual(vacpToolResult([shared, shared, row, row]), [{ n: 1 }, { n: 1 }, [1, 2], [1, 2]]);
});

test('a large collection is read only as far as the cut', () => {
  let read = 0;
  class Counted extends Set<number> {
    override *[Symbol.iterator](): SetIterator<number> {
      for (const value of this.values()) {
        read++;
        yield value;
      }
    }
  }
  const tags = new Counted(Array.from({ length: 10_000 }, (_, index) => index));
  const result = vacpToolResult({ tags, bytes: new Uint8Array(1_000) });
  assert.ok(read <= 500, `read ${read} of 10,000 items`);
  assert.deepEqual(result, {
    tags: [...Array.from({ length: 499 }, (_, index) => index), '[9501 more items]'],
    bytes: [...new Array(499).fill(0), '[501 more items]'],
  });
});
