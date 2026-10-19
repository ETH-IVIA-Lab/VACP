import {
  VACP_TOOL_RESULT_LIMITS,
  type VacpDataSqlParams,
  type VacpDataSqlResult,
  type VacpRef,
} from '@ethivia/vacp-protocol';

import type { VacpDuckDbQueryClient } from './client';
import { normalizeSingleStatementSql } from './sql';

type VacpDuckDbHandle = { allSql: string; selectedSql: string };

export type VacpDuckDbHandleResolver = (
  handleRef: VacpRef,
) => VacpDuckDbHandle | null | Promise<VacpDuckDbHandle | null>;

/**
 * Answer `vacp.data_sql` from DuckDB for the handles `resolveHandle` knows, binding `vacp_all` and
 * `vacp_handle` to the relations each resolves. JSON results return at most `maxRows` rows, 500 by
 * default, the rows one tool result keeps.
 */
export function createDuckDbDataSqlHandler(args: {
  duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>;
  resolveHandle: VacpDuckDbHandleResolver;
}): (params: VacpDataSqlParams) => Promise<VacpDataSqlResult> {
  return async (params) => {
    const handle = await args.resolveHandle(params.handleRef);

    if (!handle) throw new Error(`Unknown DataHandle: ${params.handleRef}`);

    const allSql = normalizeSingleStatementSql(handle.allSql);
    const selectedSql = normalizeSingleStatementSql(handle.selectedSql);

    const format = params.format ?? 'json';
    const sql = normalizeSingleStatementSql(params.sql);
    // Query-local bindings cannot overwrite another handle on a shared client.
    // Nest the caller's query so its own WITH/RECURSIVE scope stays intact.
    const boundSql = `WITH vacp_all AS (${allSql}\n), vacp_handle AS (${selectedSql}\n) SELECT * FROM (${sql}\n) AS __vacp_query`;

    if (format === 'arrow_ipc_base64') {
      const arrowIpcBase64 = await (await args.duckdb).queryArrowIpcBase64(boundSql);

      return { format, resolvedSql: boundSql, arrowIpcBase64 };
    }

    const maxRows = params.maxRows ?? VACP_TOOL_RESULT_LIMITS.items;
    const wrapped = `${boundSql} LIMIT ${Math.floor(maxRows) + 1}`;
    const { columns, rows } = await (await args.duckdb).queryJson(wrapped);
    const truncated = rows.length > maxRows;

    return {
      format: 'json',
      resolvedSql: wrapped,
      columns,
      rows: truncated ? rows.slice(0, maxRows) : rows,
      truncated,
    };
  };
}
