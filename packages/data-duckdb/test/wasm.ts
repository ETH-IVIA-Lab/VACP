import { fileURLToPath } from 'node:url';
import { createDuckDB, NODE_RUNTIME, VoidLogger } from '@duckdb/duckdb-wasm/blocking';
import type { VacpDuckDbQueryClient } from '../src/index';
import { arrowTableToJson } from '../src/json';

/**
 * DuckDB-Wasm in this process, blocking instead of in a worker, behind the client port. Query results
 * convert through the same Arrow reader as the browser client's, so tests read the values it returns.
 */
export async function wasmDuckDb() {
  const db = await createDuckDB(
    {
      mvp: {
        mainModule: fileURLToPath(import.meta.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm')),
        mainWorker: '',
      },
      eh: { mainModule: fileURLToPath(import.meta.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm')), mainWorker: '' },
    },
    new VoidLogger(),
    NODE_RUNTIME,
  );
  await db.instantiate();
  const connection = db.connect();
  const client: VacpDuckDbQueryClient = {
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
  };
  return { client, close: () => connection.close() };
}
