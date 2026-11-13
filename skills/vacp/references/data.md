# SQL over the app's data

Agents can query the rows behind a view through `vacp.data_sql` and `vacp.data_schema`. Add them only when the task needs answers the charts' actions cannot give. Pick the row that matches the page:

| The page                   | Do this                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Runs no DuckDB             | `pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0`, then call `createDuckDbWasmClient()` |
| Runs Mosaic on DuckDB-Wasm | Share that database, as in [vgplot.md](vgplot.md)                                                |
| Runs its own DuckDB-Wasm   | Pass it: `createDuckDbWasmClient({ duckdb, connection })`                                        |
| Queries DuckDB on a server | Implement `VacpDuckDbClient` from `@ethivia/vacp-sdk/data` over your endpoint                    |

`createDuckDbWasmClient()` starts [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) on the first query. Without `bundles`, it downloads the engine from the [jsDelivr](https://www.jsdelivr.com) CDN, so the page's content security policy must allow that origin. Pass `createDuckDbWasmClient({ bundles })` to serve the files yourself.

For Vega-Lite and vgplot, pass `data: { duckdb }` to the provider and read [vega-lite.md](vega-lite.md) or [vgplot.md](vgplot.md). The rest of this page connects a custom provider.

## Add a data handle to a custom provider

A data handle is a node of kind `DataHandle`. `allSql` selects every row, and `selectedSql` selects the rows the current filters keep. In an agent's query they appear as `vacp_all` and `vacp_handle`.

```ts
import { createVacpActions } from '@ethivia/vacp-sdk';
import {
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  sqlIdentifier,
} from '@ethivia/vacp-sdk/data';
import { createDuckDbWasmClient } from '@ethivia/vacp-duckdb';

declare const rows: Record<string, unknown>[];
declare const minScore: () => number;

const handleRef = 'vacp://sales/data/accounts';
const table = sqlIdentifier('accounts');
const duckdb = createDuckDbWasmClient();
const loaded = duckdb.then((db) => db.loadObjectsAsTable('accounts', rows));
const where = () => `score >= ${minScore()}`;

async function forHandle<Handle>(ref: string, handle: Handle) {
  if (ref !== handleRef) return null;
  await loaded;
  return handle;
}

const actions = createVacpActions();
registerVacpDataSqlAction(
  actions,
  createDuckDbDataSqlHandler({
    duckdb,
    resolveHandle: (ref) =>
      forHandle(ref, { allSql: `SELECT * FROM ${table}`, selectedSql: `SELECT * FROM ${table} WHERE ${where()}` }),
  }),
  { inputRefs: [handleRef] },
);
registerVacpDataSchemaAction(
  actions,
  createDuckDbDataSchemaHandler({ duckdb, resolveHandle: (ref) => forHandle(ref, { table: 'accounts' }) }),
  { inputRefs: [handleRef] },
);

export const dataNode = {
  ref: handleRef,
  kind: 'DataHandle',
  layer: 'DataLayer',
  title: 'Accounts',
  data: { table: 'accounts' },
};
export const dataState = () => ({ kind: 'DataHandle', rowCount: rows.length, selectionWhere: where() });
```

Add `dataNode` to `graph.nodes` and `{ [handleRef]: dataState() }` to `state`.

- The handler accepts one statement and wraps it in a `SELECT`, so an agent can read the handle and cannot write through it.
- JSON results return at most 500 rows by default. The agent can lower `maxRows`.
- Call `(await duckdb).dispose()` after the runtime is disposed, when your app owns the client.

To keep `vacp.data_schema` and withhold SQL on a chart provider, pass `data: { duckdb, sql: false }`.
