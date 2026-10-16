import type { VacpDataHandleDescriber } from '@vacp/protocol';

import type { VacpDuckDbQueryClient } from './client';
import { describeDuckDbTable } from './metadata';

/**
 * A `data.describe` hook for a host whose tables stay as they loaded: it counts each table's
 * rows the first time a handle reads it, then states that count on every later read. A count that
 * fails, such as for a table still loading, is tried again on the next read.
 */
export function countDuckDbTablesOnce(
  duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>,
): VacpDataHandleDescriber {
  const counts = new Map<string, Promise<number | null>>();
  return async ({ table }) => {
    let count = counts.get(table);
    if (!count) {
      count = Promise.resolve(duckdb).then(
        async (client) => (await describeDuckDbTable({ duckdb: client, table })).rowCount,
      );
      counts.set(table, count);
      count.catch(() => counts.delete(table));
    }
    const rowCount = await count.catch(() => null);
    return rowCount === null ? undefined : { rowCount };
  };
}
