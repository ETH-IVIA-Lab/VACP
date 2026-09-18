import assert from 'node:assert/strict';
import test from 'node:test';
import { arrowTableToJson } from '../src/json';

test('Arrow cells retain scalar, temporal, integer, binary and nested values in JSON results', () => {
  const values = [
    42,
    9007199254740993n,
    new Date('2026-01-01T00:00:00Z'),
    new Uint8Array([1, 2]),
    { toArray: () => [3, 4] },
    { toJSON: () => ({ city: 'Zurich' }) },
  ];
  const table = {
    schema: { fields: [{ name: 'value' }] },
    numRows: values.length,
    getChild: () => ({ get: (index: number) => values[index] }),
  };
  assert.deepEqual(arrowTableToJson(table), {
    columns: ['value'],
    rows: [
      { value: 42 },
      { value: '9007199254740993' },
      { value: '2026-01-01T00:00:00.000Z' },
      { value: [1, 2] },
      { value: [3, 4] },
      { value: { city: 'Zurich' } },
    ],
  });
});
