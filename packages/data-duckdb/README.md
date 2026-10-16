# @vacp/data-duckdb

## Purpose

DuckDB helpers for VACP providers and examples.

This package standardizes how apps expose semantic data access through actions declaring the `vacp.data_sql` operation contract.

## When to use

- You want tools or agents to query the app dataset through a stable semantic action.
- You want to back `vacp.data_sql` with DuckDB (WASM or server-side).

## Conceptual model

- Apps expose one or more dataset handles in the VACP graph.
- Tools and agents discover the `vacp.data_sql` contract for a handle, then execute its action name.
- The handler executes DuckDB queries and returns results.

`createDuckDbDataSqlHandler({ duckdb, resolveHandle })` answers `vacp.data_sql`, returning 500 JSON rows unless `maxRows` names another limit, which `registerVacpDataSqlAction` caps at 500, and `createDuckDbDataSchemaHandler({ duckdb, resolveHandle })` answers `vacp.data_schema` for the tables each handle reads. `describeDuckDbTable({ duckdb, table, detail })` reads one table's columns and row count, with bounded summaries when `detail` is `full`. `countDuckDbTablesOnce(duckdb)` is an adapter's `data.describe` hook for a host whose tables stay as they loaded: it counts each table the first time a handle reads it and states that count from then on.

Queries read `vacp_all` and `vacp_handle` as query-local relations. Independent handlers can share a DuckDB client without overwriting each other's bindings. Queries that read an invalid selection reject rather than returning unfiltered data.

`client.loadObjectsAsTable(table, rows, { types })` loads rows into a table. Each column in `types` holds text that loads with its type: wall-clock text such as `2012-06-01T00:00:00.000` as `TIMESTAMP`, and decimal text such as `24999.5` as `DOUBLE`, however many rows come before the first fraction. Other columns take the types DuckDB's JSON reader infers. `sqlTimestampLiteral(time, clock)` writes an instant as a `TIMESTAMP` literal on the `local` or `utc` clock. Query results return a `DATE` as its day, a `TIMESTAMP` as wall-clock text, and a `TIMESTAMP WITH TIME ZONE` as an ISO instant.

## Minimal usage

Install a `vacp.data_sql` handler during integration (through `@vacp/runtime` or a provider).

`createDuckDbWasmClient({ bundles })` starts DuckDB-Wasm from `bundles` on first use, the engine builds an application serves itself. Without them it loads DuckDB's published builds from jsDelivr. `instantiateDuckDbWasm({ bundles })` starts the same engine at once, for a consumer that manages its own connection, such as a Mosaic `DuckDBWASMConnector({ duckdb })`.

```ts
import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const client = await createDuckDbWasmClient({
  bundles: {
    mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
    eh: { mainModule: ehModule, mainWorker: ehWorker },
  },
});
```

Call `dispose()` on clients returned by `createDuckDbWasmClient()` when their owner closes. Disposal releases connections and workers created by the client. Injected connections and databases remain owned by the caller.

`VacpDuckDbQueryClient` provides `exec`, `queryJson`, and `queryArrowIpcBase64` for SQL handlers and Mosaic. `VacpDuckDbClient` adds row loading for materializing Vega data. `describeDuckDbColumns({ duckdb, table })` reads column metadata. Row loading releases its registered JSON file and temporary typed table after success or failure.

## Related docs

- [Runtime reference](../../docs/api/runtime.md)
- [Agent tools](../../docs/api/agent-tools.md)
