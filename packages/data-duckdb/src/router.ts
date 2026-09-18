import type { VacpDuckDbClient } from './client.js';
import type { VacpDataSqlParams, VacpRef } from '@vacp/protocol';
import { createDuckDbDataSqlHandler } from './data-sql.js';

export type VacpDuckDbHandleSpec = {
  handleRef: VacpRef;
  getAllSql: () => string | Promise<string>;
  getSelectedSql: () => string | Promise<string>;
};

/**
 * Build a `vacp.data_sql` handler for one or more DataHandles.
 *
 * This is intentionally composable:
 * - providers add handles lazily (even across view switches)
 * - the handler stays stable for the bridge/runtime
 * - only one `vacp.data_sql` action needs to be registered
 */
export function createDuckDbSqlRouter(args: {
  duckdb: VacpDuckDbClient | Promise<VacpDuckDbClient>;
  defaultMaxRows?: number;
}) {
  const handles = new Map<VacpRef, VacpDuckDbHandleSpec>();

  const addHandle = (spec: VacpDuckDbHandleSpec) => {
    handles.set(spec.handleRef, spec);
  };

  const removeHandle = (handleRef: VacpRef) => {
    handles.delete(handleRef);
  };

  const handler = createDuckDbDataSqlHandler({
    duckdb: {
      exec: async (sql) => await Promise.resolve(args.duckdb).then((d) => d.exec(sql)),
      queryJson: async (sql) => await Promise.resolve(args.duckdb).then((d) => d.queryJson(sql)),
      queryArrowIpcBase64: async (sql) => await Promise.resolve(args.duckdb).then((d) => d.queryArrowIpcBase64(sql)),
      loadObjectsAsTable: async (table, rows, options) =>
        await Promise.resolve(args.duckdb).then((d) => d.loadObjectsAsTable(table, rows, options)),
    },
    resolveHandle: async (handleRef) => {
      const spec = handles.get(handleRef);

      if (!spec) return null;

      return { allSql: await spec.getAllSql(), selectedSql: await spec.getSelectedSql() };
    },
    defaultMaxRows: args.defaultMaxRows,
  });

  return { addHandle, removeHandle, handler: (p: VacpDataSqlParams) => handler(p) };
}
