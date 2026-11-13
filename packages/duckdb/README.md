# @ethivia/vacp-duckdb

Starts [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview), the in-browser build of the DuckDB SQL database, as a client that VACP providers query. With a client, a provider exposes its data handles to agents through the `vacp.data_sql` and `vacp.data_schema` actions.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0 zod
```

Pass the client to a provider's `data` option. Here `root`, `view`, `spec`, and `vgSpec` come from a chart set up as in the [Vega-Lite guide](https://docs.vacp.dev/vega-lite/):

```ts
import { createDuckDbWasmClient } from '@ethivia/vacp-duckdb';
import { createVegaLiteProvider } from '@ethivia/vacp-vega';

const duckdb = createDuckDbWasmClient();
const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
  data: { duckdb },
  appId: 'analysis',
  viewId: 'overview',
  vizId: 'scatter',
});
```

The provider accepts the client's promise and waits for the engine only when an agent first reads the data. Without `bundles`, `createDuckDbWasmClient()` loads DuckDB's published builds from jsDelivr. Pass `bundles` with the engine and worker URLs to serve them from your application.

- [Custom provider](https://docs.vacp.dev/custom-provider/), with a data handle of your own
- [`@ethivia/vacp-duckdb` reference](https://docs.vacp.dev/api/duckdb)

## License

Apache-2.0
