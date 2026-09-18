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

## Minimal usage

Install a `vacp.data_sql` handler during integration (often via `@vacp/sdk` or a provider).

Call `dispose()` on clients returned by `createDuckDbWasmClient()` when their owner closes. Disposal releases connections and workers created by the client; injected connections and databases remain owned by the caller.

## Related docs

- [Core runtime](../../docs/reference/runtime.md)
- [Tool Contract](../../docs/reference/tool-contract.md)
