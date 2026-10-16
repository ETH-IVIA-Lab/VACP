import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonValue } from '../src/json';

test('selection capture preserves object keys that also name JavaScript prototype members', () => {
  const value = JSON.parse('{"__proto__":{"label":"first"},"constructor":{"label":"second"}}');
  assert.deepEqual(jsonValue(value), value);
});
