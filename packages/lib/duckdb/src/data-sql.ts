import type { VacpDataSqlParams, VacpDataSqlResult, VacpRef } from '@vacp/core';

import type { VacpDuckDbClient } from './client';
import { normalizeSingleStatementSql } from './sql';

export type VacpDuckDbHandle = { allSql: string; selectedSql: string };
export type VacpDuckDbHandleResolver = (
  handleRef: VacpRef,
) => VacpDuckDbHandle | null | Promise<VacpDuckDbHandle | null>;

export function createDuckDbDataSqlHandler(args: {
  duckdb: VacpDuckDbClient;
  resolveHandle: VacpDuckDbHandleResolver;
  defaultMaxRows?: number;
}): (params: VacpDataSqlParams) => Promise<VacpDataSqlResult> {
  const maxRowsDefault = args.defaultMaxRows ?? 500;

  // Serialize `vacp.data_sql` calls to keep the `vacp_handle`/`vacp_all` temp
  // view binding predictable.
  let chain = Promise.resolve<void>(undefined);
  const runExclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    let release: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = chain;
    chain = chain.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      release!();
    }
  };

  return async (params) =>
    await runExclusive(async () => {
      const handle = await args.resolveHandle(params.handleRef);
      if (!handle) throw new Error(`Unknown DataHandle: ${params.handleRef}`);

      const allSql = normalizeSingleStatementSql(handle.allSql);
      const selectedSql = normalizeSingleStatementSql(handle.selectedSql);

      await args.duckdb.exec(`CREATE OR REPLACE TEMP VIEW vacp_all AS ${allSql}`);
      try {
        await args.duckdb.exec(`CREATE OR REPLACE TEMP VIEW vacp_handle AS ${selectedSql}`);
      } catch {
        // If the provider-supplied selection predicate is incompatible with the
        // underlying relation (for example due to missing columns), fall back
        // to the unfiltered relation. This keeps `vacp.data_sql` robust across
        // heterogeneous views.
        await args.duckdb.exec(`CREATE OR REPLACE TEMP VIEW vacp_handle AS ${allSql}`);
      }

      const format = params.format ?? 'json';
      const sql = normalizeSingleStatementSql(params.sql);

      if (format === 'arrow_ipc_base64') {
        const arrowIpcBase64 = await args.duckdb.queryArrowIpcBase64(sql);
        return { format, resolvedSql: sql, arrowIpcBase64 };
      }

      const maxRows = params.maxRows ?? maxRowsDefault;
      const wrapped = `WITH __vacp_q AS (${sql}) SELECT * FROM __vacp_q LIMIT ${Math.floor(maxRows) + 1}`;
      const { columns, rows } = await args.duckdb.queryJson(wrapped);
      const truncated = rows.length > maxRows;
      return {
        format: 'json',
        resolvedSql: wrapped,
        columns,
        rows: truncated ? rows.slice(0, maxRows) : rows,
        truncated,
      };
    });
}
