# Mosaic vgplot

`@ethivia/vacp-vgplot` lets an agent set the brushes, legends, inputs, and tables of a [Mosaic](https://idl.uw.edu/mosaic/) vgplot dashboard and query its data. Mosaic links views through shared selections that filter database queries. The provider changes those selections the way Mosaic's own interactors do, so linked views update through Mosaic.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-vgplot zod \
  @uwdata/vgplot @uwdata/mosaic-core @uwdata/mosaic-inputs @uwdata/mosaic-plot @uwdata/mosaic-sql
```

This example assumes the Mosaic coordinator already holds a `trips` table with an `hour` column:

```ts
import * as vg from '@uwdata/vgplot';
import { createVgplotProvider, type VgplotPlotLike } from '@ethivia/vacp-vgplot';
import { installVacpRuntime } from '@ethivia/vacp-sdk';

const brush = vg.Selection.crossfilter();
const element = vg.plot(
  vg.rectY(vg.from('trips', { filterBy: brush }), { x: vg.bin('hour'), y: vg.count() }),
  vg.intervalX({ as: brush }),
);
const dashboard = document.querySelector('#dashboard')!;
dashboard.append(element);

const plot = (element as HTMLElement & { value: VgplotPlotLike }).value;
await plot.update?.();
const provider = createVgplotProvider({
  root: dashboard,
  plots: [{ plotId: 'hours', plot }],
  appId: 'taxis',
  viewId: 'overview',
  title: 'NYC taxi rides',
});
const { runtime, dispose } = installVacpRuntime({ providers: [provider], exposeBridge: true });
```

- vgplot returns each plot's element and keeps the plot object in the element's `value`. Pass each plot object with a stable `plotId`. Add `tables: [{ tableId, table }]` for Mosaic tables.
- Create the provider after the plots render. Mosaic attaches interactors and legends during the first render, and the provider finds them when you create it.
- `root` lets the provider find menu, search, and slider inputs and place presence targets.
- `appId` and `viewId` form the refs, so keep them stable across reloads. The plot above is `vacp://taxis/overview/hours`.

## Install one copy of Mosaic

The provider recognizes Mosaic objects by their classes, so the application must bundle one copy of each Mosaic package. Install the `@uwdata/mosaic-*` versions that `@uwdata/vgplot` depends on, from `0.35.0` up. If the provider meets an object from a second copy, provider creation fails with an error that names the package.

## Change brushes, legends, and inputs

Each interactor, legend, input, and table is a node in the graph. Find an action by its [contract](../concepts/#action), then call it with the node's ref and values in data units:

```ts
const { graph } = await runtime.observe();
const setBrush = graph.actions.find((action) => action.operation.contract === 'vgplot.set_interval_1d')!;
const brushRef = graph.nodes.find((node) => node.kind === 'InteractionTarget')!.ref;
await runtime.execute(
  { name: setBrush.name, params: { ref: brushRef, min: 6, max: 12 } },
  { narration: 'Keeping rides picked up between 6 and 12 in the morning.' },
);
```

Setting one brush leaves the others in place, and each clear action removes only its target. The [vgplot reference](../api/vgplot) lists every contract and its parameters.

## Query dashboard data with SQL

Pass `data` to give each table the marks read a data handle that agents query with SQL. Mosaic and the agent share one database, so SQL reads the same tables the plots render. The DuckDB-Wasm client comes from `@ethivia/vacp-duckdb`:

```bash
pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0
```

Connect Mosaic to the database before the plots render, and hand the same database to the client:

```ts
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { createDuckDbWasmClient, instantiateDuckDbWasm } from '@ethivia/vacp-duckdb';
import { countDuckDbTablesOnce } from '@ethivia/vacp-sdk/data';

const database = await instantiateDuckDbWasm();
const connector = new DuckDBWASMConnector({ duckdb: database });
coordinator().databaseConnector(connector);
const duckdb = await createDuckDbWasmClient({ duckdb: database, connection: await connector.getConnection() });
await duckdb.loadObjectsAsTable('trips', rows); // your rows, before the plots query them

const provider = createVgplotProvider({
  root: dashboard,
  plots: [{ plotId: 'hours', plot }],
  data: { duckdb, describe: countDuckDbTablesOnce(duckdb) },
  appId: 'taxis',
  viewId: 'overview',
});
```

The provider registers `vacp.data_sql` and `vacp.data_schema` with the handlers from `@ethivia/vacp-sdk/data`. A handle's `vacp_handle` holds the table's rows narrowed by each selection that filters a view of that table. `countDuckDbTablesOnce` counts each table's rows once, for tables that stay as they loaded.

[DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) runs the DuckDB SQL database in the browser. Mosaic depends on a prerelease of `@duckdb/duckdb-wasm`, so a plain install loads two engines and fails to type-check when they share a database. Add this override, then run `pnpm install`. A single app needs the file too: create `pnpm-workspace.yaml` beside `package.json` with these lines. With npm, put `overrides` in `package.json`.

```yaml
overrides:
  '@duckdb/duckdb-wasm': 1.32.0
```

Without `bundles`, `instantiateDuckDbWasm()` downloads the engine from the [jsDelivr](https://www.jsdelivr.com) CDN, which the page's [content security policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) must allow. Pass `instantiateDuckDbWasm({ bundles })` to serve the engine files yourself. The [DuckDB reference](../api/duckdb) covers both functions.

## Show presence on the dashboard

`createVgplotPresentation` from `@ethivia/vacp-vgplot` creates the dashboard's [presentation](../concepts/#presence), which tells [presence](../presence/) where the dashboard's plots, brushes, and inputs are on screen:

```ts
import { createVgplotPresentation } from '@ethivia/vacp-vgplot';
import { createPresenceOverlay } from '@ethivia/vacp-overlay';

const presence = createPresenceOverlay(runtime);
presence.attach(provider, createVgplotPresentation(provider));
```

## Restore recorded state

The provider registers `vacp.apply_state`, so [provenance replay](../provenance/) restores selections, inputs, and table sorting and paging. Restoration replays the interactor that set the active selection clause last, so each crossfilter leaves the same view unfiltered as it did when recorded.

Try the [vgplot gallery](https://examples.vacp.dev/vgplot/). Next, [compose the dashboard with other sources](../composition/).
