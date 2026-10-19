# @ethivia/vacp-duckdb

DuckDB clients and the handlers behind `vacp.data_sql` and `vacp.data_schema`. The visualization adapters use them for their data handles, and a custom provider registers them with [`registerVacpDataSqlAction` and `registerVacpDataSchemaAction`](./runtime#standard-operations).

## Clients

```ts
type VacpDuckDbQueryClient = {
  exec(sql: string): Promise<void>;
  queryJson(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  queryArrowIpcBase64(sql: string): Promise<string>;
};
type VacpDuckDbClient = VacpDuckDbQueryClient & {
  loadObjectsAsTable(
    table: string,
    rows: Record<string, unknown>[],
    options?: { types?: Record<string, 'TIMESTAMP' | 'DOUBLE'> },
  ): Promise<void>;
};
```

The vgplot adapter and the handlers need a query client. The Vega-Lite adapter loads chart data, so it needs a full client. `loadObjectsAsTable` creates `table`. To replace a table, drop it first. Columns named in `types` hold text that loads with that type: wall-clock text such as `2012-06-01T00:00:00.000` as `TIMESTAMP`, decimal text as `DOUBLE`. Other columns take the types DuckDB infers. Query results convert dates to ISO text and large integers to numbers or strings that keep their value.

### createDuckDbWasmClient

```ts
createDuckDbWasmClient(options?:
  | { bundles?: DuckDBBundles; log?: boolean }
  | { duckdb: AsyncDuckDB; connection?: AsyncDuckDBConnection }
): Promise<VacpDuckDbWasmClient>
```

With `bundles` or no options, the client owns a [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) database and starts it in a worker on first use. Without `bundles`, the engine files load from jsDelivr, so the page needs network access to that origin. With `duckdb`, borrows a database the application already runs, such as Mosaic's, and opens a connection on first use unless `connection` is given. `dispose()` closes what the client opened and terminates an owned database. A borrowed database and connection stay open.

`instantiateDuckDbWasm({ bundles?, log? })` starts a database at once, without wrapping it, for an application that shares it with Mosaic.

## Handlers

```ts
createDuckDbDataSqlHandler({
  duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>,
  resolveHandle: (ref: VacpRef) => { allSql: string; selectedSql: string } | null | Promise<...>,
}): (params: VacpDataSqlParams) => Promise<VacpDataSqlResult>

createDuckDbDataSchemaHandler({
  duckdb,
  resolveHandle: (ref: VacpRef) => { table: string; allTable?: string } | null | Promise<...>,
}): (params: VacpDataSchemaParams) => Promise<VacpDataSchemaResult>
```

The SQL handler binds `vacp_all` to `allSql` and `vacp_handle` to `selectedSql` for one query, then runs the caller's SQL inside them. The SQL must be one statement. JSON results return at most `maxRows` rows, 500 by default, with `truncated` set when more existed. `resolvedSql` holds the statement that ran.

The query runs on the client's connection with that connection's rights. It can read every table on the connection, and DuckDB can fetch remote files by URL. Give agents a connection that holds only the data they may read.

Both handlers throw `Unknown DataHandle` for a ref `resolveHandle` does not know. `detail: 'full'` adds numeric, temporal, and top-category summaries, computed over at most `sampleRows` rows when given.

## Helpers

| Export                                                         | Returns                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `countDuckDbTablesOnce(duckdb)`                                | A data handle describer that counts each table once and reuses the count. Use it for tables that never change after loading |
| `describeDuckDbTable({ duckdb, table, detail?, sampleRows? })` | A `VacpDataSchemaTable` for one table                                                                                       |
| `describeDuckDbColumns({ duckdb, table })`                     | The table's columns, without a row count                                                                                    |
| `makeVacpDuckDbTableName({ prefix, parts?, suffixLength? })`   | A safe table name with a random suffix                                                                                      |
| `sqlIdentifier(name)`, `sqlStringLiteral(value)`               | Quoted SQL identifiers and strings                                                                                          |
| `sqlTimestampLiteral(ms, clock)`                               | A `TIMESTAMP` literal of an instant's wall-clock time on a clock                                                            |
