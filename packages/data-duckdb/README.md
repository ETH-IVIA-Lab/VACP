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

Queries read `vacp_all` and `vacp_handle` as query-local relations. Independent handlers can share a DuckDB client without overwriting each other's bindings. Queries that read an invalid selection reject rather than returning unfiltered data.

`client.loadObjectsAsTable(table, rows, { types })` loads rows into a table. Each column in `types` holds text that loads with its type: wall-clock text such as `2012-06-01T00:00:00.000` as `TIMESTAMP`, and decimal text such as `24999.5` as `DOUBLE`, however many rows come before the first fraction. Other columns take the types DuckDB's JSON reader infers. `sqlTimestampLiteral(time, clock)` writes an instant as a `TIMESTAMP` literal on the `local` or `utc` clock. Query results return a `DATE` as its day, a `TIMESTAMP` as wall-clock text, and a `TIMESTAMP WITH TIME ZONE` as an ISO instant.

## Minimal usage

Install a `vacp.data_sql` handler during integration (often via `@vacp/sdk` or a provider).

`createDuckDbWasmClient({ bundles })` starts DuckDB-Wasm from `bundles`, the engine builds an application serves itself. Without them it loads DuckDB's published builds from jsDelivr. `instantiateDuckDbWasm({ bundles })` starts the same engine for a consumer that manages its own connection, such as a Mosaic `DuckDBWASMConnector({ duckdb })`.

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

Call `dispose()` on clients returned by `createDuckDbWasmClient()` when their owner closes. Disposal releases connections and workers created by the client; injected connections and databases remain owned by the caller.

## Related docs

- [Core runtime](../../docs/reference/runtime.md)
- [Tool Contract](../../docs/reference/tool-contract.md)
