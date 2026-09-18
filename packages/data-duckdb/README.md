# @vacp/data-duckdb

## Purpose

DuckDB helpers for VACP providers and examples.

This package standardizes how apps expose semantic data access through the `vacp.data_sql` action.

## When to use

- You want tools or agents to query the app dataset through a stable semantic action.
- You want to back `vacp.data_sql` with DuckDB (WASM or server-side).

## Conceptual model

- Apps expose one or more dataset handles in the VACP graph.
- Tools/agents call `vacp.data_sql` against those handles.
- The handler executes DuckDB queries and returns results.

## Minimal usage

Install a `vacp.data_sql` handler during integration (often via `@vacp/sdk` or a provider).

## Related docs

- [Core runtime](../../docs/reference/runtime.md)
- [Tool Contract](../../docs/reference/tool-contract.md)
