import type { VacpActionDescriptor, VacpRef } from '@vacp/core';
import type { VacpDuckDbClient, VacpDuckDbTableMetadata } from '@vacp/duckdb';
import {
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  getDuckDbTableMetadata,
  makeVacpDuckDbTableName,
} from '@vacp/duckdb';
import { registerVacpDataSqlAction, type VacpActionRegistry } from '@vacp/gateway';

import { whereClauseForCurrentSelections } from './duckdb-selection';
import { makeRef } from './refs';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike, VegaViewLike } from './types';

export type VegaLiteDuckDbDataHandle = {
  ref: VacpRef;
  tableName: string;
  ensureMetadata: () => Promise<VacpDuckDbTableMetadata | null>;
};

/**
 * Optional DuckDB-backed DataHandle for Vega-Lite specs that embed inline data.
 *
 * This keeps DuckDB "first class" without requiring any additional data APIs:
 * - providers expose one semantic action: `vacp.data_sql`
 * - debug tools and transports can query selection state with SQL only
 */
export function installVegaLiteDuckDbDataHandle(args: {
  spec: VegaLiteSpecLike;
  view: VegaViewLike;
  options: InstallVacpOnVegaLiteOptions;
  actionRegistry: VacpActionRegistry;
  actionDescriptors: VacpActionDescriptor[];
}): VegaLiteDuckDbDataHandle | null {
  const { spec, view, options, actionRegistry, actionDescriptors } = args;

  const enableDuckDb = options.enableDuckDbDataHandle ?? true;
  const inlineValues = spec.data && typeof spec.data === 'object' && Array.isArray((spec.data as any).values);
  const dataRows = inlineValues ? ((spec.data as any).values as unknown[]) : null;
  if (!enableDuckDb || !dataRows) return null;

  const handleRef = makeRef({
    appId: options.appId,
    viewId: options.viewId,
    vizId: options.vizId,
    suffix: '/data/main',
  }) as VacpRef;

  const duckdbPromise: Promise<VacpDuckDbClient> = (() => {
    if (options.duckdbClient) return Promise.resolve(options.duckdbClient);
    const rootAny = globalThis as unknown as Record<string, unknown>;
    const existing = rootAny.__vacpDuckDbClient;
    if (existing && typeof (existing as Promise<unknown>).then === 'function')
      return existing as Promise<VacpDuckDbClient>;
    const created: Promise<VacpDuckDbClient> = createDuckDbWasmClient({ log: false });
    rootAny.__vacpDuckDbClient = created;
    return created;
  })();

  // DuckDB is shared across the page, so we use unique per-install table names
  // and best-effort cleanup for this view key.
  const tableName = (() => {
    const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`;
    const name = makeVacpDuckDbTableName({ prefix: base });

    const viewKey = `${options.appId}/${options.viewId}/${options.vizId}`;
    const rootAny = globalThis as unknown as { __vacpVegaLiteDuckDbTables?: Record<string, string> };
    const map = (rootAny.__vacpVegaLiteDuckDbTables ??= {});
    const prev = map[viewKey];
    map[viewKey] = name;
    if (prev && prev !== name) {
      void duckdbPromise.then((db) => db.exec(`DROP TABLE IF EXISTS main.${prev}`)).catch(() => {});
    }

    return name;
  })();

  let duckdbLoad: Promise<void> | null = null;
  const ensureDuckDbData = async (): Promise<void> => {
    if (duckdbLoad) return await duckdbLoad;
    duckdbLoad = (async () => {
      const db = await duckdbPromise;
      const rows = dataRows
        .map((d) => (d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null))
        .filter((d): d is Record<string, unknown> => !!d);

      try {
        await db.exec(`DROP VIEW IF EXISTS main.${tableName}`);
        await db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
      } catch {
        // best-effort
      }

      try {
        await db.loadObjectsAsTable(tableName, rows, { create: true });
        return;
      } catch (err) {
        // Fall back to a "truncate + insert" approach.
        try {
          await db.exec(`DELETE FROM main.${tableName}`);
        } catch {
          // ignore
        }
        try {
          await db.loadObjectsAsTable(tableName, rows, { create: false });
          return;
        } catch {
          await db.loadObjectsAsTable(tableName, rows, { create: true });
        }
        void err;
      }
    })();
    await duckdbLoad;
  };

  void ensureDuckDbData().catch(() => {});

  let meta: VacpDuckDbTableMetadata | null = null;
  const ensureMetadata = async (): Promise<VacpDuckDbTableMetadata | null> => {
    if (meta) return meta;
    await ensureDuckDbData();
    const db = await duckdbPromise;
    try {
      meta = await getDuckDbTableMetadata({ duckdb: db, table: tableName, sampleRows: 25_000 });
    } catch {
      meta = null;
    }
    return meta;
  };

  const dataSqlDesc = registerVacpDataSqlAction(
    actionRegistry,
    createDuckDbDataSqlHandler({
      duckdb: {
        getConnection: () => duckdbPromise.then((d) => d.getConnection()),
        exec: (sql) => duckdbPromise.then((d) => d.exec(sql)),
        queryJson: (sql) => duckdbPromise.then((d) => d.queryJson(sql)),
        queryArrowIpcBase64: (sql) => duckdbPromise.then((d) => d.queryArrowIpcBase64(sql)),
        loadObjectsAsTable: (t, rows, opts) => duckdbPromise.then((d) => d.loadObjectsAsTable(t, rows, opts)),
      },
      resolveHandle: async (ref) => {
        if (ref !== handleRef) return null;
        await ensureDuckDbData();
        const allSql = `SELECT * FROM ${tableName}`;
        const where = whereClauseForCurrentSelections(spec, view);
        const selectedSql = where ? `SELECT * FROM ${tableName} WHERE ${where}` : allSql;
        return { allSql, selectedSql };
      },
    }),
    { targetRef: handleRef, description: 'Query the current Vega-Lite selection using DuckDB SQL.' },
  );
  actionDescriptors.push(dataSqlDesc);

  return { ref: handleRef, tableName, ensureMetadata };
}
