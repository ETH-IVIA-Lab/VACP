# @vacp/duckdb

DuckDB helpers for VACP providers and examples.

This package standardizes how examples/providers in this repo expose data access through the `vacp.data_sql` action:

- apps provide one or more `DataHandle` refs in the VACP graph
- agents/tools call `vacp.data_sql` against those handles
- the handler runs DuckDB queries and returns rows/Arrow IPC

## What it provides

- `createDuckDbWasmClient`: in-browser DuckDB WASM client implementing `VacpDuckDbClient`.
- `createDuckDbDataSqlHandler`: implementation of the `vacp.data_sql` action over DuckDB.
- Metadata helpers: `getDuckDbTableMetadata`, `formatDuckDbTableMetadataSummary`.
- Naming: `makeVacpDuckDbTableName`.

## References

- Used by the BYO-provider kit (`@vacp/kit`) and the examples under `packages/examples/*`.
- The debug overlay (`@vacp/debug-ui`) includes a **Data** module that can call `vacp.data_sql`.

