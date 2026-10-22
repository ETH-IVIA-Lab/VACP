# Mosaic vgplot

`@ethivia/vacp-vgplot` exposes the plots, interactors, legends, inputs, and tables of a [Mosaic](https://idl.uw.edu/mosaic/) vgplot dashboard. Mosaic links views through shared selections that filter queries in a database, and the adapter changes those selections the way Mosaic's own interactors do, so linked views update through Mosaic's dataflow.

```ts
import { createVgplotProvider } from '@ethivia/vacp-vgplot';
import { installVacpRuntime } from '@ethivia/vacp-browser';

const provider = createVgplotProvider({
  root: dashboard,
  plots: [
    { plotId: 'pickups', plot: pickups },
    { plotId: 'dropoffs', plot: dropoffs },
  ],
  options: { appId: 'taxis', viewId: 'overview', title: 'NYC taxi rides' },
});
const { runtime, dispose } = installVacpRuntime({ providers: [provider], exposeBridge: true, injectDomSnapshot: true });
```

- Each plot entry pairs a stable `plotId` with the vgplot plot object. Add `tables: [{ tableId, table }]` for Mosaic tables.
- `root` lets the adapter discover menu, search, and slider inputs inside the dashboard and place presence targets.
- `options.appId` and `options.viewId` make up the refs, so keep them stable across reloads.

Create the provider after the plots render, for example after `await plot.update()`. The provider finds each plot's interactors and legends when it is created, and Mosaic attaches them during the first render.

## Install one copy of Mosaic

The adapter recognizes interactors, legends, and inputs by their Mosaic classes, which survive minification where constructor names do not. `@uwdata/mosaic-plot`, `@uwdata/mosaic-inputs`, and `@uwdata/mosaic-sql` are peer dependencies at `^0.33.0`. Install the versions `@uwdata/vgplot` uses, so the application bundles one copy of each. Provider creation fails with an error naming the package when it meets an object from a second copy whose class names are readable. A minified second copy goes unrecognized.

## Operations

Every operation targets an entity by its ref and takes values in data units. Find the operation by its contract, then call it by name:

```ts
const { graph } = await runtime.observe();
const setBrush = graph.actions.find((action) => action.operation.contract === 'vgplot.set_interval_1d')!;
await runtime.execute(
  { name: setBrush.name, params: { ref: brushRef, min: 6, max: 12 } },
  { narration: 'Keeping rides picked up between 6 and 12 in the morning.' },
);
```

| Contracts                                                                       | Target                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `vgplot.set_interval_1d`, `vgplot.clear_interval_1d`                            | A one-dimensional brush                               |
| `vgplot.set_interval_2d`, `vgplot.clear_interval_2d`                            | A two-dimensional brush                               |
| `vgplot.set_region`, `vgplot.clear_region`                                      | A region selection                                    |
| `vgplot.set_toggle`, `vgplot.clear_toggle`, `vgplot.clear_nearest`              | Point selections                                      |
| `vgplot.set_pan_zoom`, `vgplot.clear_pan_zoom`                                  | A pan and zoom interactor                             |
| `vgplot.set_legend_toggle`, `vgplot.clear_legend_toggle`                        | A categorical legend                                  |
| `vgplot.set_input_value`, `vgplot.set_input_option_index`, `vgplot.clear_input` | A menu, search, or slider input                       |
| `vgplot.table_set_sort`, `vgplot.table_clear_sort`, `vgplot.table_set_page`     | A Mosaic table                                        |
| `vacp.widget_options`                                                           | The options of a menu input                           |
| `vacp.apply_state`                                                              | Restores recorded selections, inputs, and tables      |
| `vacp.data_sql`, `vacp.data_schema`                                             | Query the dashboard's tables, when `data` is supplied |

Interval endpoints may come in either order. A call whose ref names an entity of another kind fails before anything changes. Read the refs from the graph: each interactor, legend, input, and table is a node.

## Crossfilters

A Mosaic crossfilter keeps the plot the brush belongs to unfiltered and filters the other views that subscribe through `filterBy`. In the [NYC taxi rides](https://examples.vacp.dev/vgplot/#nyc-taxi-rides) entry, brushing pickups filters the dropoff map, and the hour histogram filters both maps while staying whole itself. An agent reads the linked views' state to see a brush's effect.

Each interactor's state holds its own `selectionValue`, or `null` when its clause is inactive. Setting one brush leaves the others in place. Clear operations remove only the targeted brush, so an agent keeps unrelated selections unless the person asks to remove them.

## Restoration

The adapter records each shared Mosaic selection once as a `Selection` state entry. Its `activeSource` is the ref of the interactor that supplied the active clause, or `null` when no clause is active. The clause values themselves live in each interactor's `selectionValue`.

Mosaic uses the active source to decide which view a crossfilter leaves unfiltered. Restoration therefore replays every interactor's value and replays the active source's interactor last. An `activeSource` of `null` clears the selection's active clause. When the active interaction has no ref, `activeSource` is absent and restoration reports that entry as skipped.

## Query chart data

Supply `data` to give each table the marks read a data handle:

```ts
import { Coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { createDuckDbWasmClient, instantiateDuckDbWasm } from '@ethivia/vacp-duckdb';

const connector = new DuckDBWASMConnector({ duckdb: await instantiateDuckDbWasm({ bundles }) });
const coordinator = new Coordinator(connector);
const duckdb = await createDuckDbWasmClient({
  duckdb: await connector.getDuckDB(),
  connection: await connector.getConnection(),
});
createVgplotProvider({ root, plots, data: { duckdb }, options });
```

Mosaic and the client share one database, so SQL reads the tables the plots render. `bundles` names the [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) engine files the application serves. Without it, `instantiateDuckDbWasm()` downloads them from the [jsDelivr](https://www.jsdelivr.com) CDN, which a page's [content security policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) must allow.

A handle's `vacp_handle` holds the table's rows narrowed by each selection that filters a view of that table through `filterBy`, built with Mosaic's own SQL. Its state reports the predicate as `selectionWhere`. A selection that only highlights, or that filters views of another table, leaves the handle whole. When the adapter cannot translate a selection to SQL, the handle reports `selectionError` and its queries fail.

Mosaic reports no revision for its tables, so a handle's `rowCount` is `null` unless the host states it. A host whose tables stay as they loaded can count each table once:

```ts
import { countDuckDbTablesOnce } from '@ethivia/vacp-duckdb';

createVgplotProvider({ root, plots, data: { duckdb, describe: countDuckDbTablesOnce(duckdb) }, options });
```

Try the [vgplot gallery](https://examples.vacp.dev/vgplot/). The [API reference](../api/vgplot) lists every option and operation parameter.
