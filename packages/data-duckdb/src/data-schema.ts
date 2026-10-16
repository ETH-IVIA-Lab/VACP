import type { VacpDataSchemaParams, VacpDataSchemaResult, VacpRef } from '@vacp/protocol';

import type { VacpDuckDbQueryClient } from './client';
import { describeDuckDbTable } from './metadata';

/** The relation `vacp_handle` reads, and `vacp_all`'s when that reads another relation. */
type SchemaHandle = { table: string; allTable?: string };

/**
 * Answer `vacp.data_schema` from DuckDB for the handles `resolveHandle` knows, describing the
 * relation `vacp_handle` reads under `vacp_handle`, and the relation `vacp_all` reads under
 * `vacp_all` when it is another. An unknown handle rejects.
 */
export function createDuckDbDataSchemaHandler(args: {
  duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>;
  resolveHandle(handleRef: VacpRef): SchemaHandle | null | Promise<SchemaHandle | null>;
}): (params: VacpDataSchemaParams) => Promise<VacpDataSchemaResult> {
  return async ({ handleRef, detail = 'columns', sampleRows }) => {
    const handle = await args.resolveHandle(handleRef);
    if (!handle) throw new Error(`Unknown DataHandle: ${handleRef}`);
    const duckdb = await args.duckdb;
    const describe = (table: string) => describeDuckDbTable({ duckdb, table, detail, sampleRows });
    const own = await describe(handle.table);
    const all = handle.allTable && handle.allTable !== handle.table ? await describe(handle.allTable) : undefined;
    return { handleRef, detail, vacp_handle: own, ...(all ? { vacp_all: all } : {}) };
  };
}
