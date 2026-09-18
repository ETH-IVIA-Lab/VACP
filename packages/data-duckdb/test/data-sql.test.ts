import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDuckDB, NODE_RUNTIME, VoidLogger, type DuckDBConnection } from '@duckdb/duckdb-wasm/blocking';
import { createDuckDbDataSqlHandler, type VacpDuckDbClient } from '../src/index';
import { arrowTableToJson } from '../src/json';

let connection: DuckDBConnection;

before(async () => {
  const db = await createDuckDB(
    {
      mvp: { mainModule: fileURLToPath(import.meta.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm')) },
      eh: { mainModule: fileURLToPath(import.meta.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm')) },
    },
    new VoidLogger(),
    NODE_RUNTIME,
  );
  await db.instantiate();
  connection = db.connect();
});

after(() => connection.close());

const client: VacpDuckDbClient = {
  async exec(sql) {
    connection.query(sql);
  },
  async queryJson(sql) {
    return arrowTableToJson(connection.query(sql));
  },
  async queryArrowIpcBase64(sql) {
    const bytes = connection.useUnsafe((bindings, id) => bindings.runQuery(id, sql));
    return Buffer.from(bytes).toString('base64');
  },
  async loadObjectsAsTable() {
    throw new Error('This fixture uses SQL-defined relations');
  },
};

test('independent handlers sharing a connection keep JSON and Arrow handle bindings isolated', async () => {
  const handlers = [10, 20].map((value) =>
    createDuckDbDataSqlHandler({
      duckdb: client,
      resolveHandle: () => ({
        allSql: `SELECT ${value} AS value UNION ALL SELECT ${value + 1}`,
        selectedSql: `SELECT ${value} AS value`,
      }),
    }),
  );

  const results = await Promise.all(
    handlers.map((handler) =>
      handler({
        handleRef: 'vacp://test/data',
        sql: 'SELECT h.value, (SELECT count(*)::INTEGER FROM vacp_all) AS total FROM vacp_handle h',
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.format === 'json' && result.rows),
    [[{ value: 10, total: 2 }], [{ value: 20, total: 2 }]],
  );

  const arrows = await Promise.all(
    handlers.map((handler) =>
      handler({ handleRef: 'vacp://test/data', sql: 'SELECT * FROM vacp_handle', format: 'arrow_ipc_base64' }),
    ),
  );
  for (const [index, result] of arrows.entries()) {
    assert.ok(result.format === 'arrow_ipc_base64');
    assert.equal(result.arrowIpcBase64, await client.queryArrowIpcBase64(`SELECT ${index === 0 ? 10 : 20} AS value`));
  }
});

test('query-local bindings preserve nested and recursive CTEs, aliases, and row limits', async () => {
  const handler = createDuckDbDataSqlHandler({
    duckdb: client,
    resolveHandle: () => ({
      allSql: 'WITH source AS (SELECT 1 AS value) SELECT * FROM source',
      selectedSql: 'SELECT * FROM vacp_all -- selected relation',
    }),
  });
  const result = await handler({
    handleRef: 'vacp://test/data',
    sql: `WITH RECURSIVE series(value) AS (
      SELECT h.value FROM "vacp_handle" AS h
      UNION ALL SELECT value + 1 FROM series WHERE value < 3
    ) SELECT value FROM series ORDER BY value -- preserve this comment`,
    maxRows: 2,
  });
  assert.ok(result.format === 'json');
  assert.deepEqual(result.rows, [{ value: 1 }, { value: 2 }]);
  assert.equal(result.truncated, true);
});

test('invalid selection SQL fails instead of exposing all rows', async () => {
  const handler = createDuckDbDataSqlHandler({
    duckdb: client,
    resolveHandle: () => ({ allSql: 'SELECT 1 AS value', selectedSql: 'SELECT missing FROM vacp_all' }),
  });
  await assert.rejects(handler({ handleRef: 'vacp://test/data', sql: 'SELECT * FROM vacp_handle' }), /missing/);
});
