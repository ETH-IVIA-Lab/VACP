# @ethivia/vacp-sdk/data

These exports build [data handles](./protocol#data-handles) and answer the `vacp.data_sql` and `vacp.data_schema` actions from [DuckDB](https://duckdb.org), an SQL database that runs inside your process. Any object that implements [`VacpDuckDbQueryClient`](#vacpduckdbqueryclient) works as the client. [`@ethivia/vacp-duckdb`](./duckdb) provides one that runs DuckDB-Wasm in the page.

```ts
import {
  countDuckDbTablesOnce,
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  describeDuckDbColumns,
  describeDuckDbTable,
  formatVacpWallClock,
  makeVacpDuckDbTableName,
  normalizeSingleStatementSql,
  parseVacpInstant,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  sqlIdentifier,
  sqlStringLiteral,
  sqlTimestampLiteral,
  vacpDataHandle,
  type JsonObject,
  type JsonScalar,
  type JsonValue,
  type VacpClock,
  type VacpDataHandleData,
  type VacpDataHandleDescriber,
  type VacpDataHandleState,
  type VacpDataSchemaColumn,
  type VacpDataSchemaResult,
  type VacpDuckDbClient,
  type VacpDuckDbLoadType,
  type VacpDuckDbQueryClient,
} from '@ethivia/vacp-sdk/data';
```

Register a handler on a provider's actions with [`registerVacpDataSqlAction`](#registervacpdatasqlaction) and [`registerVacpDataSchemaAction`](#registervacpdataschemaaction):

```ts
import { createVacpActions } from '@ethivia/vacp-sdk';
import { createDuckDbDataSqlHandler, registerVacpDataSqlAction } from '@ethivia/vacp-sdk/data';
import { createDuckDbWasmClient } from '@ethivia/vacp-duckdb';

const handleRef = 'vacp://shop/orders/data/main';
const actions = createVacpActions();
const handler = createDuckDbDataSqlHandler({
  duckdb: createDuckDbWasmClient(),
  resolveHandle: (ref) =>
    ref === handleRef ? { allSql: 'SELECT * FROM orders', selectedSql: 'SELECT * FROM orders WHERE open' } : null,
});
registerVacpDataSqlAction(actions, handler, { inputRefs: [handleRef] });
```

## VacpDuckDbQueryClient

```ts
type VacpDuckDbQueryClient = {
  exec(sql: string): Promise<void>;
  queryJson(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  queryArrowIpcBase64(sql: string): Promise<string>;
};
```

The client the handlers, the `describeDuckDb*` functions, and [`createVgplotProvider`](./vgplot) query.

- `exec`: runs one statement and discards its result.
- `queryJson`: returns the column names and one object per row.
- `queryArrowIpcBase64`: returns the result as a base64 [Arrow IPC](https://arrow.apache.org/docs/format/Columnar.html#serialization-and-interprocess-communication-ipc) stream, the binary table format of Apache Arrow.

## VacpDuckDbClient

```ts
type VacpDuckDbClient = VacpDuckDbQueryClient & {
  loadObjectsAsTable(
    tableName: string,
    rows: Record<string, unknown>[],
    options?: { types?: Readonly<Record<string, VacpDuckDbLoadType>> },
  ): Promise<void>;
};
type VacpDuckDbLoadType = 'TIMESTAMP' | 'DOUBLE';
```

A query client that also loads rows. [`createVegaLiteProvider`](./vega) needs it to load chart data.

`loadObjectsAsTable` creates `tableName`. To replace a table, drop it first.

- `options.types`: casts the text in the named columns. `TIMESTAMP` reads wall-clock text such as `2012-06-01T00:00:00.000`, and `DOUBLE` reads decimal text such as `24999.5`. Default: every column takes the type DuckDB infers.

## createDuckDbDataSqlHandler

```ts
function createDuckDbDataSqlHandler(options: {
  duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>;
  resolveHandle: (ref: VacpRef) => Handle | null | Promise<Handle | null>;
}): (params: {
  handleRef: VacpRef;
  sql: string;
  format?: 'json' | 'arrow_ipc_base64';
  maxRows?: number;
}) => Promise<Result>;
// Handle: { allSql: string; selectedSql: string }
// Result: { format: 'json'; resolvedSql; columns; rows; truncated } | { format: 'arrow_ipc_base64'; resolvedSql; arrowIpcBase64 }
```

Returns a handler that answers [`vacp.data_sql`](./protocol#standard-contracts) for the handles `resolveHandle` knows. It binds `vacp_all` to `allSql` and `vacp_handle` to `selectedSql` for one statement, then runs `params.sql` inside them.

- `options.duckdb`: the client, or a promise of it.
- `options.resolveHandle`: returns the two relations of a handle, or `null` for a ref it does not know.
- `params.sql`: one SQL statement.
- `params.format`: `json` or `arrow_ipc_base64`. Default: `json`.
- `params.maxRows`: the rows a JSON result returns. Default: `500`. An Arrow result returns every row.

`resolvedSql` holds the statement that ran. `truncated` is `true` when the query had more rows than `maxRows`.

Rejects with `Unknown DataHandle: <ref>` when `resolveHandle` returns `null`, and with an error from [`normalizeSingleStatementSql`](#normalizesinglestatementsql) for SQL that is empty or holds more than one statement.

::: warning
The query runs with the rights of the client's connection. It can read every table on that connection, and DuckDB can fetch remote files by URL. Give agents a connection that holds only the data they may read. The handler rejects a write statement such as `DROP TABLE` with `vacp.data_sql runs read queries only`.
:::

## createDuckDbDataSchemaHandler

```ts
function createDuckDbDataSchemaHandler(options: {
  duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>;
  resolveHandle: (ref: VacpRef) => Handle | null | Promise<Handle | null>;
}): (params: { handleRef: VacpRef; detail?: 'columns' | 'full'; sampleRows?: number }) => Promise<VacpDataSchemaResult>;
// Handle: { table: string; allTable?: string }
```

Returns a handler that answers [`vacp.data_schema`](./protocol#standard-contracts) for the handles `resolveHandle` knows.

- `options.resolveHandle`: returns the relation `vacp_handle` reads as `table`, and the relation `vacp_all` reads as `allTable` when that is another one. Returns `null` for a ref it does not know.
- `params.detail`: `columns` reads the columns, their types, and the row count. `full` adds summaries, described in [`describeDuckDbTable`](#describeduckdbtable). Default: `columns`.
- `params.sampleRows`: the rows `full` scans, as in `describeDuckDbTable`.

Rejects with `Unknown DataHandle: <ref>` when `resolveHandle` returns `null`.

## registerVacpDataSqlAction

```ts
function registerVacpDataSqlAction(
  registry: VacpActionRegistry,
  handler: (params: { handleRef; sql; format?; maxRows? }, context: VacpActionExecutionContext) => unknown,
  options?: { availability?: VacpAvailability; inputRefs?: VacpRef[]; description?: string },
): VacpActionDescriptor;
```

Registers [`vacp.data_sql`](./protocol#standard-contracts). [`createDuckDbDataSqlHandler`](#createduckdbdatasqlhandler) provides the handler.

- `handler`: answers a parsed call. `sql` is nonblank, `format` is `json` or `arrow_ipc_base64`, and `maxRows` is an integer from 1 to 500.
- `options.availability`: the action's [availability](./protocol#vacpavailability). Default: available.
- `options.inputRefs`: the data handles it reads.
- `options.description`: replaces the default description.

Returns the descriptor. Other parameters fail with `invalid-params` details.

## registerVacpDataSchemaAction

```ts
function registerVacpDataSchemaAction(
  registry: VacpActionRegistry,
  handler: (
    params: { handleRef; detail?; sampleRows? },
    context: VacpActionExecutionContext,
  ) => VacpDataSchemaResult | Promise<VacpDataSchemaResult>,
  options?: { availability?: VacpAvailability; inputRefs?: VacpRef[]; description?: string },
): VacpActionDescriptor;
```

Registers [`vacp.data_schema`](./protocol#standard-contracts). [`createDuckDbDataSchemaHandler`](#createduckdbdataschemahandler) provides the handler. `detail` is `columns` or `full`, and `sampleRows` is a finite number of at least 0. The options match `registerVacpDataSqlAction`. Returns the descriptor.

## VacpDataSchemaResult

```ts
type VacpDataSchemaResult = {
  handleRef: VacpRef;
  detail: 'columns' | 'full';
  vacp_handle: Table;
  vacp_all?: Table;
};
// Table: { table; rowCount: number | null; columns: VacpDataSchemaColumn[]; numeric?; temporal?; categoricalTopValues?; sampledRows? }
```

The result of `vacp.data_schema`. `vacp_all` is present when `vacp_all` reads a relation other than `vacp_handle`'s.

## VacpDataSchemaColumn

```ts
type VacpDataSchemaColumn = { name: string; type: string; notNull?: true; primaryKey?: true };
```

One column of a relation. `notNull` and `primaryKey` are present only where the constraint holds.

## describeDuckDbTable

```ts
function describeDuckDbTable(options: {
  duckdb: VacpDuckDbQueryClient;
  table: string;
  detail?: 'columns' | 'full';
  sampleRows?: number;
}): Promise<Table>;
```

Describes one table, in the `Table` shape of [`VacpDataSchemaResult`](#vacpdataschemaresult).

- `detail`: `full` adds `numeric` (`min`, `max`, and `avg` of up to 8 numeric columns), `temporal` (the bounds of up to 6 date or time columns), and `categoricalTopValues` (the 5 most frequent values of up to 4 text columns). Default: `columns`.
- `sampleRows`: the rows `full` scans, from the start of the table. `0` scans every row. Default: `25000`.

`sampledRows` holds the sample size, or `null` when `full` scanned every row. A numeric column whose bounds read as epoch timestamps also has `unitHint`, `minIso`, and `maxIso`.

## describeDuckDbColumns

```ts
function describeDuckDbColumns(options: {
  duckdb: VacpDuckDbQueryClient;
  table: string;
}): Promise<VacpDataSchemaColumn[]>;
```

Returns the columns of `table`, without counting its rows.

## countDuckDbTablesOnce

```ts
function countDuckDbTablesOnce(duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>): VacpDataHandleDescriber;
```

Returns a describer that counts each table the first time a handle reads it and reports that count on every later read. Use it for tables that stay as they loaded. A count that fails, such as for a table still loading, reports nothing and runs again on the next read.

## vacpDataHandle

```ts
function vacpDataHandle(
  read: {
    ref: VacpRef;
    table: string;
    columns?: VacpDataSchemaColumn[];
    rowCount: number | null;
    selectionWhere: string | null;
  },
  describe?: VacpDataHandleDescriber,
): Promise<{ data: VacpDataHandleData; state: VacpDataHandleState }>;
```

Builds a `DataHandle` node's `data` and its state from what a provider read and what its host's describer reports. A host's `rowCount` replaces the provider's. A describer that throws adds nothing.

## VacpDataHandleDescriber

```ts
type VacpDataHandleDescriber = (handle: {
  ref: VacpRef;
  table: string;
}) => Facts | undefined | Promise<Facts | undefined>;
// Facts: { rowCount?: number; metadata?: JsonObject; stats?: JsonObject }
```

The `data.describe` hook of the visualization providers. The provider calls it each time it reads the handle, and every graph and state read waits for it, so answer from what the host already knows.

- `rowCount`: the rows the relation holds at the time of the read.
- `metadata`: what the data is, such as its source, grain, or units. Models read it as the node's `data.metadata`.
- `stats`: current figures about the data. Models read them as the `stats` field of the handle's state.

## VacpDataHandleData

```ts
type VacpDataHandleData = { table: string; columns?: VacpDataSchemaColumn[]; metadata?: JsonObject };
```

The `data` of a `DataHandle` node. [Data handles](./protocol#data-handles) describes each field.

## VacpDataHandleState

```ts
type VacpDataHandleState = {
  kind: 'DataHandle';
  rowCount: number | null;
  selectionWhere: string | null;
  stats?: JsonObject;
};
```

The state of a `DataHandle` node. [Data handles](./protocol#data-handles) describes each field.

## makeVacpDuckDbTableName

```ts
function makeVacpDuckDbTableName(options: { prefix: string; parts?: string[]; suffixLength?: number }): string;
```

Returns `prefix` and `parts` joined by `_`, followed by a random suffix. The name holds letters, numbers, and underscores, so it is safe unquoted in SQL.

- `parts`: more name segments. Default: none.
- `suffixLength`: the length of the random suffix. Default: `8`.

## normalizeSingleStatementSql

```ts
function normalizeSingleStatementSql(sql: string): string;
```

Trims `sql` and removes trailing semicolons. Throws when nothing remains, or when a semicolon remains outside single or double quotes.

## sqlIdentifier

```ts
function sqlIdentifier(name: string): string;
```

Returns `name` as a double-quoted SQL identifier, for reserved words and special characters.

## sqlStringLiteral

```ts
function sqlStringLiteral(value: string): string;
```

Returns `value` as a single-quoted SQL string.

## sqlTimestampLiteral

```ts
function sqlTimestampLiteral(time: number, clock: VacpClock): string;
```

Returns a `TIMESTAMP` literal that holds the wall-clock time of the instant `time`, in epoch milliseconds, on `clock`.

## VacpClock

```ts
type VacpClock = 'local' | 'utc';
```

The clock a temporal axis reads: the browser's local time or UTC.

## parseVacpInstant

```ts
function parseVacpInstant(text: string, clock: VacpClock): number;
```

Returns the instant that ISO 8601 `text` names, in epoch milliseconds. A date alone means its midnight, and a time without an offset is wall-clock time, both on `clock`. Text ending in `Z` or an offset names its instant exactly. Throws a `RangeError` for other text, and for a date the calendar lacks, such as `2012-02-30`.

## formatVacpWallClock

```ts
function formatVacpWallClock(time: number, clock: VacpClock): string;
```

Returns the instant `time`, in epoch milliseconds, as wall-clock text on `clock`: `YYYY-MM-DDTHH:mm:ss.sss`, without an offset.

## JSON values

```ts
type JsonScalar = string | number | boolean | null | undefined;
type JsonValue = JsonScalar | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
```

The values a data handle's `metadata` and `stats` hold.
