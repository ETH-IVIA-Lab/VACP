import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { getDuckDbTableMetadata, type VacpDuckDbClient } from '../src/index';
import { wasmDuckDb } from './wasm';

let client: VacpDuckDbClient;
let close: () => void;

before(async () => {
  ({ client, close } = await wasmDuckDb());
  await client.exec(
    `CREATE TABLE readings AS SELECT * FROM (VALUES
      (1, TIMESTAMP '2012-06-01 00:00:00', 12.5),
      (2, TIMESTAMP '2012-06-03 12:00:00', 15.5)
    ) AS t(id, taken, temp_max)`,
  );
  await client.exec('CREATE TABLE keyed (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, note VARCHAR)');
});

after(() => close());

test('a TIMESTAMP column reports the wall-clock bounds it holds, whatever the local zone', async () => {
  const meta = await getDuckDbTableMetadata({ duckdb: client, table: 'readings' });
  assert.deepEqual(meta.temporal?.taken, {
    minIso: '2012-06-01T00:00:00.000Z',
    maxIso: '2012-06-03T12:00:00.000Z',
    minEpochMs: Date.UTC(2012, 5, 1),
    maxEpochMs: Date.UTC(2012, 5, 3, 12),
  });
  assert.deepEqual(meta.numeric?.temp_max, { min: 12.5, max: 15.5, avg: 14 });
});

test('columns name their constraints only where they hold', async () => {
  const meta = await getDuckDbTableMetadata({ duckdb: client, table: 'keyed', sampleRows: 0 });
  assert.deepEqual(meta.columns, [
    { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true },
    { name: 'name', type: 'VARCHAR', notNull: true },
    { name: 'note', type: 'VARCHAR' },
  ]);
});
