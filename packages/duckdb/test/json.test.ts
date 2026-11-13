import assert from 'node:assert/strict';
import test from 'node:test';
import { DateDay, Int32, Table, TimestampMillisecond, vectorFromArray } from 'apache-arrow';
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
    schema: { fields: [{ name: 'value', type: { typeId: 0 } }] },
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

test('a DATE reads as its day, a TIMESTAMP as wall-clock time, and a zoned TIMESTAMP as an instant', () => {
  const day = Date.UTC(2014, 5, 1);
  const table = new Table({
    day: vectorFromArray([new Date(day), null], new DateDay()),
    at: vectorFromArray([day + 3_600_000, null], new TimestampMillisecond()),
    instant: vectorFromArray([day, null], new TimestampMillisecond('UTC')),
    count: vectorFromArray([3, null], new Int32()),
  });
  assert.deepEqual(arrowTableToJson(table).rows, [
    { day: '2014-06-01', at: '2014-06-01T01:00:00.000', instant: '2014-06-01T00:00:00.000Z', count: 3 },
    { day: null, at: null, instant: null, count: null },
  ]);
});
