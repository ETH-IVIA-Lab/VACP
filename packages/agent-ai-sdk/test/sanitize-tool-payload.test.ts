import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeToolPayload } from '../src/sanitize-tool-payload';

test('sanitizeToolPayload normalizes non-JSON values into JSON-safe output', () => {
  const date = new Date('2026-03-05T12:34:56.000Z');
  const circular: Record<string, unknown> = { keep: 'ok', skip: undefined, when: date };
  circular.self = circular;

  const sanitized = sanitizeToolPayload({
    date,
    nested: { a: 1, skip: undefined, when: date },
    array: [1, undefined, date],
    typed: new Uint8Array([1, 2, 3]),
    big: 42n,
    invalidDate: new Date('not-a-date'),
    circular,
  }) as Record<string, unknown>;

  assert.equal(sanitized.date, '2026-03-05T12:34:56.000Z');
  assert.deepEqual(sanitized.nested, { a: 1, when: '2026-03-05T12:34:56.000Z' });
  assert.deepEqual(sanitized.array, [1, null, '2026-03-05T12:34:56.000Z']);
  assert.deepEqual(sanitized.typed, [1, 2, 3]);
  assert.equal(sanitized.big, '42');
  assert.equal(sanitized.invalidDate, null);
  assert.deepEqual(sanitized.circular, {
    keep: 'ok',
    when: '2026-03-05T12:34:56.000Z',
    self: '[circular]',
  });
});

test('sanitizeToolPayload bounds large strings, arrays, and objects', () => {
  const hugeObject = Object.fromEntries(Array.from({ length: 170 }, (_, index) => [`k${index}`, index]));

  const sanitized = sanitizeToolPayload({
    text: 'x'.repeat(12_010),
    items: Array.from({ length: 505 }, (_, index) => index),
    hugeObject,
  }) as Record<string, unknown>;

  assert.equal(typeof sanitized.text, 'string');
  assert.match(sanitized.text as string, /\[truncated 10 chars\]$/);

  const items = sanitized.items as unknown[];
  assert.equal(items.length, 501);
  assert.deepEqual(items[500], { __truncated: '5 more items' });

  const object = sanitized.hugeObject as Record<string, unknown>;
  assert.equal(object.k0, 0);
  assert.equal(object.k159, 159);
  assert.equal(object.k160, undefined);
  assert.equal(object.__truncated, '10 more keys');
});
