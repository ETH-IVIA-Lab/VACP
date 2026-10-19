import { DuckDBInstance } from '@duckdb/node-api';
import type { VacpDuckDbQueryClient } from '@ethivia/vacp-duckdb';

/** A DuckDB engine in this process behind the client port, counting the queries it answers. */
export async function nodeDuckDb() {
  const connection = await (await DuckDBInstance.create(':memory:')).connect();
  let queries = 0;
  const client: VacpDuckDbQueryClient = {
    exec: async (sql) => {
      await connection.run(sql);
    },
    queryJson: async (sql) => {
      queries++;
      const result = await connection.runAndReadAll(sql);
      return { columns: result.columnNames(), rows: result.getRowObjectsJson() as Record<string, unknown>[] };
    },
    queryArrowIpcBase64: async () => {
      throw new Error('Arrow IPC results are read in the browser');
    },
  };
  return { client, queries: () => queries, close: () => connection.closeSync() };
}
