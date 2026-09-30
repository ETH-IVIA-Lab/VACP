import { DuckDBInstance } from '@duckdb/node-api';
import { sqlIdentifier, sqlStringLiteral, type VacpDuckDbClient } from '@vacp/data-duckdb';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A DuckDB engine in this process, behind the client port the adapter uses in the browser. Rows load
 * through a JSON file and one typed copy, as the browser client loads them, so tests read the rows a
 * query selects from a real engine.
 */
export async function nodeDuckDb() {
  const connection = await (await DuckDBInstance.create(':memory:')).connect();
  const files = mkdtempSync(join(tmpdir(), 'vacp-vega-lite-'));
  const tables = new Set<string>();
  let loads = 0;
  const client: VacpDuckDbClient = {
    exec: async (sql) => {
      await connection.run(sql);
      const dropped = /^DROP TABLE IF EXISTS main\.(\w+)$/.exec(sql)?.[1];
      if (dropped) tables.delete(dropped);
    },
    queryJson: async (sql) => {
      const result = await connection.runAndReadAll(sql);
      return { columns: result.columnNames(), rows: result.getRowObjectsJson() as Record<string, unknown>[] };
    },
    queryArrowIpcBase64: async () => {
      throw new Error('Arrow IPC results are read in the browser');
    },
    loadObjectsAsTable: async (table, rows, options) => {
      const file = join(files, `${table}.json`);
      writeFileSync(file, JSON.stringify(rows));
      const casts = (options?.timestamps ?? []).map(
        (column) => `CAST(${sqlIdentifier(column)} AS TIMESTAMP) AS ${sqlIdentifier(column)}`,
      );
      const select = `SELECT * ${casts.length ? `REPLACE (${casts.join(', ')})` : ''} FROM read_json_auto(${sqlStringLiteral(file)})`;
      await connection.run(`CREATE TABLE main.${table} AS ${select}`);
      tables.add(table);
      loads++;
    },
  };
  return {
    client,
    tables,
    loads: () => loads,
    /** Column name to DuckDB type for a loaded table. */
    types: async (table: string) =>
      Object.fromEntries(
        (
          await client.queryJson(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`,
          )
        ).rows.map((row) => [row.column_name, row.data_type]),
      ),
    close: () => connection.closeSync(),
  };
}
