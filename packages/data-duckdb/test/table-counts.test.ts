import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { countDuckDbTablesOnce, type VacpDuckDbQueryClient } from '../src/index';
import { wasmDuckDb } from './wasm';

let client: VacpDuckDbQueryClient;
let close: () => void;

before(async () => {
  ({ client, close } = await wasmDuckDb());
});

after(() => close());

test('each table is counted the first time a handle reads it and stated from then on', async () => {
  await client.exec('CREATE TABLE trips AS SELECT range AS id FROM range(12)');
  let queries = 0;
  const counted: VacpDuckDbQueryClient = {
    ...client,
    queryJson: (sql) => {
      queries++;
      return client.queryJson(sql);
    },
  };
  const describe = countDuckDbTablesOnce(counted);
  const handle = { ref: 'vacp://app/data/main', table: 'trips' } as const;
  assert.deepEqual(await describe(handle), { rowCount: 12 });
  const read = queries;
  assert.deepEqual(await describe(handle), { rowCount: 12 });
  assert.equal(queries, read);
});

test('a table that cannot be counted yet is counted on a later read', async () => {
  const describe = countDuckDbTablesOnce(client);
  const handle = { ref: 'vacp://app/data/late', table: 'late' } as const;
  assert.equal(await describe(handle), undefined);
  await client.exec('CREATE TABLE late AS SELECT range AS id FROM range(3)');
  assert.deepEqual(await describe(handle), { rowCount: 3 });
});
