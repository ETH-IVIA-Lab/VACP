import * as duckdb from '@duckdb/duckdb-wasm';

import { base64FromBytes } from './base64';
import { arrowTableToJson } from './json';
import { normalizeSingleStatementSql, sqlIdentifier } from './sql';

export type VacpDuckDbClient = {
  exec(sql: string): Promise<void>;
  queryJson(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  queryArrowIpcBase64(sql: string): Promise<string>;
  /**
   * Load rows into `tableName`. Columns in `types` hold text that loads with that type: wall-clock
   * text such as `2012-06-01T00:00:00.000` as TIMESTAMP, and decimal text such as `24999.5` as DOUBLE.
   * Other columns take the types DuckDB's JSON reader infers.
   */
  loadObjectsAsTable(
    tableName: string,
    rows: Record<string, unknown>[],
    options?: { create?: boolean; types?: Readonly<Record<string, VacpDuckDbLoadType>> },
  ): Promise<void>;
};

/** A column type `loadObjectsAsTable` casts text to. */
export type VacpDuckDbLoadType = 'TIMESTAMP' | 'DOUBLE';

type DuckDbConnection = Pick<duckdb.AsyncDuckDBConnection, 'close' | 'query' | 'insertJSONFromPath'> & {
  useUnsafe<Result>(
    callback: (
      bindings: { runQuery(connectionId: number, sql: string): Promise<Uint8Array> },
      connectionId: number,
    ) => Result,
  ): Result;
};
type DuckDbDatabase = Pick<duckdb.AsyncDuckDB, 'registerFileText'> & {
  connect(): Promise<DuckDbConnection>;
};

export type VacpDuckDbWasmClient = VacpDuckDbClient & {
  dispose(): Promise<void>;
};

/**
 * Start DuckDB-Wasm in a worker from one of `bundles`, such as engine files the application serves
 * itself. Without bundles, DuckDB's published jsDelivr builds are used.
 */
export async function instantiateDuckDbWasm(options?: {
  bundles?: duckdb.DuckDBBundles;
  log?: boolean;
}): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(options?.bundles ?? duckdb.getJsDelivrBundles());
  if (!bundle.mainWorker) throw new Error('The selected DuckDB bundle has no worker');
  // The worker starts from a blob, which resolves relative URLs against itself.
  const absolute = (url: string) => new URL(url, globalThis.location?.href).href;
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts(${JSON.stringify(absolute(bundle.mainWorker))});`], { type: 'text/javascript' }),
  );
  try {
    const worker = new Worker(workerUrl);
    const logger = options?.log ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    try {
      await db.instantiate(absolute(bundle.mainModule), bundle.pthreadWorker && absolute(bundle.pthreadWorker));
    } catch (error) {
      await db.terminate();
      throw error;
    }
    return db;
  } finally {
    URL.revokeObjectURL(workerUrl);
  }
}

export async function createDuckDbWasmClient(options?: {
  log?: boolean;
  /** Engine builds to start from when no `duckdb` is supplied. */
  bundles?: duckdb.DuckDBBundles;
  duckdb?: DuckDbDatabase;
  connection?: DuckDbConnection;
}): Promise<VacpDuckDbWasmClient> {
  const log = options?.log ?? false;
  let db: DuckDbDatabase | null = options?.duckdb ?? null;
  let ownedDb: duckdb.AsyncDuckDB | null = null;
  let con: DuckDbConnection | null = options?.connection ?? null;
  let loadPromise: Promise<void> | null = null;
  let disposal: Promise<void> | null = null;
  let disposed = false;

  const release = async (): Promise<void> => {
    const connection = options?.connection ? null : con;
    const database = ownedDb;
    con = null;
    ownedDb = null;
    if (database) db = null;
    try {
      await connection?.close();
    } finally {
      await database?.terminate();
    }
  };

  const ensureActive = (): void => {
    if (disposed) throw new Error('DuckDB client is disposed');
  };

  const getConnection = async (): Promise<DuckDbConnection> => {
    ensureActive();
    if (con) return con;

    if (!loadPromise) {
      loadPromise = (async () => {
        if (!db) {
          ownedDb = await instantiateDuckDbWasm({ bundles: options?.bundles, log });
          db = ownedDb;
        }

        con = await db.connect();
      })().catch(async (error: unknown) => {
        await release();
        throw error;
      });
    }

    await loadPromise;
    ensureActive();

    return con!;
  };

  const runQueryIpc = async (sql: string): Promise<Uint8Array> => {
    const conn = await getConnection();
    ensureActive();
    const stmt = normalizeSingleStatementSql(sql);

    return conn.useUnsafe((bindings, connId) => bindings.runQuery(connId, stmt));
  };

  return {
    dispose: () => {
      if (!disposal) {
        disposed = true;
        disposal = (async () => {
          await loadPromise?.catch(() => undefined);
          await release();
        })();
      }
      return disposal;
    },
    exec: async (sql) => {
      await runQueryIpc(sql);
    },
    queryJson: async (sql) => {
      const conn = await getConnection();
      ensureActive();
      const stmt = normalizeSingleStatementSql(sql);
      const table = await conn.query(stmt);

      return arrowTableToJson(table);
    },
    queryArrowIpcBase64: async (sql) => {
      const bytes = await runQueryIpc(sql);

      return base64FromBytes(bytes);
    },
    loadObjectsAsTable: async (tableName, rows, options) => {
      const conn = await getConnection();
      ensureActive();
      if (!db) throw new Error('Loading objects requires a DuckDB database');
      const create = options?.create ?? true;
      const path = `/${tableName}.json`;
      await db.registerFileText(path, JSON.stringify(rows));
      ensureActive();
      const typed = Object.entries(options?.types ?? {}).filter(([column, type]) => {
        if (type !== 'TIMESTAMP' && type !== 'DOUBLE') throw new TypeError(`Cannot load a column as ${String(type)}`);
        return rows.some((row) => Object.hasOwn(row, column));
      });
      if (!typed.length) {
        await conn.insertJSONFromPath(path, { name: tableName, create, schema: 'main' });
        return;
      }
      // The JSON reader keeps typed text as VARCHAR, so the rows pass through one typed copy.
      const staging = `${tableName}__load`;
      await conn.query(`DROP TABLE IF EXISTS main.${sqlIdentifier(staging)}`);
      await conn.insertJSONFromPath(path, { name: staging, create: true, schema: 'main' });
      const casts = typed.map(
        ([column, type]) => `CAST(${sqlIdentifier(column)} AS ${type}) AS ${sqlIdentifier(column)}`,
      );
      const select = `SELECT * REPLACE (${casts.join(', ')}) FROM main.${sqlIdentifier(staging)}`;
      try {
        await conn.query(
          create
            ? `CREATE TABLE main.${sqlIdentifier(tableName)} AS ${select}`
            : `INSERT INTO main.${sqlIdentifier(tableName)} ${select}`,
        );
      } finally {
        await conn.query(`DROP TABLE IF EXISTS main.${sqlIdentifier(staging)}`);
      }
    },
  };
}
