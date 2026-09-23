import assert from 'node:assert/strict';
import test from 'node:test';
import { fnv1a64Hex, stableStringify } from '../src/hash';

function referenceHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash ^ BigInt(value.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

test('64-bit tokens preserve the UTF-16 wire format across carries and overflow', () => {
  assert.equal(fnv1a64Hex(''), 'cbf29ce484222325');
  assert.equal(fnv1a64Hex('hello'), 'a430d84680aabd0b');
  const cases = [
    '\0',
    'Visualization: Zürich 📊',
    '\ud800\udfff\uffff',
    Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i)).join(''),
  ];
  // Exercise limb carries and repeated overflow with explicit input classes.
  for (const length of [1, 2, 7, 8, 31, 32, 1024]) cases.push('\uffff'.repeat(length));
  for (const value of cases) assert.equal(fnv1a64Hex(value), referenceHash(value));
});

test('canonical serialization follows JSON values rather than object identity', () => {
  const shared = { z: 2, a: 1 };
  assert.equal(
    stableStringify({ first: shared, second: shared }),
    stableStringify({ second: { a: 1, z: 2 }, first: { a: 1, z: 2 } }),
  );
  const date = new Date('2026-09-18T12:00:00Z');
  assert.equal(stableStringify({ date }), stableStringify({ date: date.toISOString() }));
  const withJson = { toJSON: () => ({ z: 2, a: 1 }) };
  assert.equal(stableStringify(withJson), '{"a":1,"z":2}');
  const circular: { self?: object } = {};
  circular.self = circular;
  assert.throws(() => stableStringify(circular), /circular/i);
});

test('canonical tokens preserve JSON property ordering, omission, and prototype-like keys', () => {
  const value = JSON.parse('{"z":3,"10":"ten","2":"two","__proto__":{"safe":true}}');
  value.a = [undefined, NaN, -0];
  value.omitted = undefined;
  assert.equal(stableStringify(value), '{"2":"two","10":"ten","__proto__":{"safe":true},"a":[null,null,0],"z":3}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.omitted, undefined);
});
