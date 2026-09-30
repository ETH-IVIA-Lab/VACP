import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDuckDbDataSchemaHandler, type VacpDuckDbClient } from '../src/index';
import { wasmDuckDb } from './wasm';

let client: VacpDuckDbClient;
let close: () => void;
let schema: ReturnType<typeof createDuckDbDataSchemaHandler>;

before(async () => {
  ({ client, close } = await wasmDuckDb());
  await client.exec(
    `CREATE TABLE readings AS SELECT * FROM (VALUES
      (1, TIMESTAMP '2012-06-01 00:00:00', 12.5),
      (2, TIMESTAMP '2012-06-03 12:00:00', 15.5)
    ) AS t(id, taken, temp_max)`,
  );
  await client.exec('CREATE TABLE warm AS SELECT * FROM readings WHERE temp_max > 14');
  await client.exec('CREATE TABLE keyed (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, note VARCHAR)');
  const tables: Record<string, { table: string; allTable?: string }> = {
    'vacp://app/readings': { table: 'readings' },
    'vacp://app/warm': { table: 'warm', allTable: 'readings' },
    'vacp://app/keyed': { table: 'keyed' },
    'vacp://app/same': { table: 'readings', allTable: 'readings' },
  };
  schema = createDuckDbDataSchemaHandler({ duckdb: client, resolveHandle: (ref) => tables[ref] ?? null });
});

after(() => close());

test('a full schema reports the wall-clock bounds a TIMESTAMP column holds, whatever the local zone', async () => {
  const result = await schema({ handleRef: 'vacp://app/readings', detail: 'full' });
  assert.deepEqual(result.vacp_handle.temporal?.taken, {
    minIso: '2012-06-01T00:00:00.000Z',
    maxIso: '2012-06-03T12:00:00.000Z',
    minEpochMs: Date.UTC(2012, 5, 1),
    maxEpochMs: Date.UTC(2012, 5, 3, 12),
  });
  assert.deepEqual(result.vacp_handle.numeric?.temp_max, { min: 12.5, max: 15.5, avg: 14 });
});

test('columns name their constraints only where they hold', async () => {
  assert.deepEqual(await schema({ handleRef: 'vacp://app/keyed' }), {
    handleRef: 'vacp://app/keyed',
    detail: 'columns',
    vacp_handle: {
      table: 'keyed',
      rowCount: 0,
      columns: [
        { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true },
        { name: 'name', type: 'VARCHAR', notNull: true },
        { name: 'note', type: 'VARCHAR' },
      ],
    },
  });
});

test('a handle whose vacp_all reads another relation describes both', async () => {
  const result = await schema({ handleRef: 'vacp://app/warm' });
  assert.equal(result.vacp_handle.rowCount, 1);
  assert.equal(result.vacp_all?.rowCount, 2);
  assert.equal((await schema({ handleRef: 'vacp://app/same' })).vacp_all, undefined);
});

test('an unknown handle rejects', async () => {
  await assert.rejects(schema({ handleRef: 'vacp://app/missing' }), /Unknown DataHandle: vacp:\/\/app\/missing/);
});
