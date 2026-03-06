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
    circular,
  }) as Record<string, unknown>;

  assert.equal(sanitized.date, '2026-03-05T12:34:56.000Z');
  assert.deepEqual(sanitized.nested, { a: 1, when: '2026-03-05T12:34:56.000Z' });
  assert.deepEqual(sanitized.array, [1, null, '2026-03-05T12:34:56.000Z']);
  assert.deepEqual(sanitized.typed, [1, 2, 3]);
  assert.equal(sanitized.big, '42');
  assert.deepEqual(sanitized.circular, {
    keep: 'ok',
    when: '2026-03-05T12:34:56.000Z',
    self: '[circular]',
  });
});
