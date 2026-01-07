import * as duckdb from '@duckdb/duckdb-wasm';

import { base64FromBytes } from './base64';
import { arrowTableToJson } from './json';
import { normalizeSingleStatementSql } from './sql';

export type VacpDuckDbClient = {
  getConnection(): Promise<duckdb.AsyncDuckDBConnection>;
  exec(sql: string): Promise<void>;
  queryJson(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  queryArrowIpcBase64(sql: string): Promise<string>;
  loadObjectsAsTable(tableName: string, rows: Record<string, unknown>[], options?: { create?: boolean }): Promise<void>;
};

export async function createDuckDbWasmClient(options?: {
  log?: boolean;
  duckdb?: duckdb.AsyncDuckDB;
  connection?: duckdb.AsyncDuckDBConnection;
}): Promise<VacpDuckDbClient> {
  const log = options?.log ?? false;
  let db: duckdb.AsyncDuckDB | null = options?.duckdb ?? null;
  let con: duckdb.AsyncDuckDBConnection | null = options?.connection ?? null;
  let loadPromise: Promise<void> | null = null;

  const ensure = async (): Promise<void> => {
    if (con) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        if (!db) {
          const bundles = duckdb.getJsDelivrBundles();
          const bundle = await duckdb.selectBundle(bundles);
          const workerUrl = URL.createObjectURL(
            new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
          );
          const worker = new Worker(workerUrl);
          const logger = log ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger();
          db = new duckdb.AsyncDuckDB(logger, worker);
          await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
          URL.revokeObjectURL(workerUrl);
        }
        con = await db!.connect();
      })();
    }
    await loadPromise;
  };

  const getConnection = async (): Promise<duckdb.AsyncDuckDBConnection> => {
    await ensure();
    return con!;
  };

  const runQueryIpc = async (sql: string): Promise<Uint8Array> => {
    const conn = await getConnection();
    const stmt = normalizeSingleStatementSql(sql);
    return await new Promise<Uint8Array>((resolve, reject) => {
      conn.useUnsafe(async (bindings, connId) => {
        try {
          const buffer = await bindings.runQuery(connId, stmt);
          resolve(buffer);
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  return {
    getConnection,
    exec: async (sql) => {
      await runQueryIpc(sql);
    },
    queryJson: async (sql) => {
      const conn = await getConnection();
      const stmt = normalizeSingleStatementSql(sql);
      const table = await conn.query(stmt);
      return arrowTableToJson(table);
    },
    queryArrowIpcBase64: async (sql) => {
      const bytes = await runQueryIpc(sql);
      return base64FromBytes(bytes);
    },
    loadObjectsAsTable: async (tableName, rows, options) => {
      if (!db) await ensure();
      const create = options?.create ?? true;
      const path = `/${tableName}.json`;
      const text = JSON.stringify(rows);
      await db!.registerFileText(path, text);
      const conn = await getConnection();
      await conn.insertJSONFromPath(path, { name: tableName, create, schema: 'main' });
    },
  };
}
