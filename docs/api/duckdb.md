# @ethivia/vacp-duckdb

Runs [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview), the browser build of the DuckDB SQL database, as a client that VACP providers and the [`/data`](./data) handlers query.

```bash
pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0
```

The package takes `@ethivia/vacp-sdk`, and `@duckdb/duckdb-wasm` from `1.32.0` as peer dependencies. `DuckDBBundles`, `AsyncDuckDB`, and `AsyncDuckDBConnection` below are types of `@duckdb/duckdb-wasm`.

```ts
import { createDuckDbWasmClient, instantiateDuckDbWasm, type VacpDuckDbWasmClient } from '@ethivia/vacp-duckdb';
```

## createDuckDbWasmClient

```ts
function createDuckDbWasmClient(
  options?: { bundles?: DuckDBBundles; log?: boolean } | { duckdb: AsyncDuckDB; connection?: AsyncDuckDBConnection },
): Promise<VacpDuckDbWasmClient>;
```

Creates a client on a database it owns, or on one your application already runs. A database the client owns starts on the client's first query.

With a database the client owns:

- `bundles`: the engine and worker files, such as files your application serves. Default: DuckDB's published builds on [jsDelivr](https://www.jsdelivr.com), so the page needs network access to that origin.
- `log`: logs DuckDB's messages to the console. Default: `false`.

With a database your application runs, such as Mosaic's:

- `duckdb`: the database. Required.
- `connection`: the connection to query. Default: a connection the client opens on its first query.

Returns a [`VacpDuckDbWasmClient`](#vacpduckdbwasmclient). Queries reject when the engine fails to start.

```ts
import { createDuckDbWasmClient, instantiateDuckDbWasm } from '@ethivia/vacp-duckdb';

const database = await instantiateDuckDbWasm();
const duckdb = await createDuckDbWasmClient({ duckdb: database });
await duckdb.exec('CREATE TABLE cars AS SELECT 1 AS id');
const { rows } = await duckdb.queryJson('SELECT * FROM cars');
```

## VacpDuckDbWasmClient

```ts
type VacpDuckDbWasmClient = VacpDuckDbClient & { dispose(): Promise<void> };
```

A [`VacpDuckDbClient`](./data#vacpduckdbclient) with a `dispose` function.

`queryJson` returns each cell as JSON:

- A `DATE` reads as its day, `2012-06-01`.
- A `TIMESTAMP` reads as wall-clock text, `2012-06-01T00:00:00.000`.
- A `TIMESTAMP WITH TIME ZONE` reads as an ISO instant ending in `Z`.
- A `BIGINT` or `HUGEINT` reads as a string that keeps its value.
- A blob reads as an array of byte values.

`dispose()` closes what the client opened and terminates a database it owns. A database and a connection your application passed in stay open. Later calls return the same promise, and queries after `dispose()` reject with `DuckDB client is disposed`.

`loadObjectsAsTable` throws a `TypeError` for a column type other than `TIMESTAMP` or `DOUBLE`.

## instantiateDuckDbWasm

```ts
function instantiateDuckDbWasm(options?: { bundles?: DuckDBBundles; log?: boolean }): Promise<AsyncDuckDB>;
```

Starts DuckDB-Wasm in a worker and returns the database, for an application that shares one database between VACP and Mosaic. Your application owns the database and terminates it.

- `bundles`: as in [`createDuckDbWasmClient`](#createduckdbwasmclient). Default: DuckDB's published builds on jsDelivr.
- `log`: logs DuckDB's messages to the console. Default: `false`.

Rejects when the selected bundle has no worker, and with DuckDB's error when the engine fails to start.
