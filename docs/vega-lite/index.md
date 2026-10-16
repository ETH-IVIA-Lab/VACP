# Vega-Lite

`@vacp/adapter-vega-lite` exposes the parameters, selections, encodings, and data of a rendered [Vega-Lite](https://vega.github.io/vega-lite/) chart. Agents set parameters and selections through the chart's own Vega view, so linked marks update as they do for a mouse interaction.

Render the chart with [vega-embed](https://github.com/vega/vega-embed), then create the provider from the embed result:

```ts
import embed from 'vega-embed';
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { installVacpRuntime } from '@vacp/runtime-browser';

const { view, spec, vgSpec } = await embed(root, chartSpec);
const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
  options: { appId: 'analysis', viewId: 'overview', vizId: 'scatter', title: 'Horsepower and mileage' },
});
const { runtime, dispose } = installVacpRuntime({ providers: [provider], exposeBridge: true, injectDomSnapshot: true });
```

- `view` is the live Vega view. `vgSpec` is the compiled Vega specification vega-embed rendered, which the adapter reads for datasets and selection signals.
- `options.appId`, `options.viewId`, and `options.vizId` make up the refs of the chart's entities, so keep them stable across reloads.
- `root` lets the adapter place tooltips and presence targets over the rendered chart. Parameters and selections work without it.

Disposing the runtime releases the provider's listeners and leaves the view to its host.

## Operations

| Contract                            | Does                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `vega_lite.set_param`               | Sets a bound or unbound parameter                                         |
| `vega_lite.set_selection`           | Sets an interval or point selection in data units                         |
| `vega_lite.clear_selection`         | Clears a selection                                                        |
| `vega_lite.hover_tooltip`           | Points at the marks whose data match given fields and shows their tooltip |
| `vacp.apply_state`                  | Restores recorded parameters and selections                               |
| `vacp.data_sql`, `vacp.data_schema` | Query the chart's data, when `data` is supplied                           |

Operation names are qualified by the source, so [find an operation by its contract](../composition/#find-an-operation-by-contract), then execute its `name`.

## Selections

`vega_lite.set_selection` sets an interval from `[min, max]` ranges keyed by channel or field. A channel left out of a two-channel brush spans its scale's current domain. On an `x`/`y` brush over horsepower and mileage, `{ y: [20, 30] }` selects mileage from 20 to 30 at every horsepower, like a full-width drag.

A time axis takes ISO dates or timestamps:

- A date such as `"2012-06-01"` means midnight on the axis's clock: local time for `time` scales and UTC for `utc` scales.
- A date and time without an offset is wall-clock time on that clock. Text ending in `Z` or an offset names an exact instant.
- A `monthdate` axis folds every year onto 2012. `{ x: ["2012-06-01", "2012-08-31"] }` selects June through August of every year, and a range in another year fails with the axis span.

A range that is not two numbers or dates, or that misses the axis domain, fails before the selection changes. The error states the domain in the axis's terms. An interval bound to its scales pans and zooms, so it accepts any range.

Selection state holds a readable `value` and, when the native store is available, the captured `tuples`. Tuples keep the fields of one selected point together and record which unit each point came from, including selections that resolve across views. `vacp.apply_state` restores the tuples, and the view evaluates once, so linked marks update together. Save the complete selection state when you record observations for replay.

## Query chart data

Supply `data` to give each of the chart's datasets a data handle, backed by a DuckDB connection your application owns:

```ts
import { createDuckDbWasmClient } from '@vacp/data-duckdb';

const duckdb = await createDuckDbWasmClient();
const provider = createVegaLiteProvider({ root, view, spec, vgSpec, data: { duckdb }, options });

// On unmount, after disposing the runtime:
await duckdb.dispose();
```

`createDuckDbWasmClient()` starts [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) in a worker on the first query. Without `bundles`, it downloads the engine from the [jsDelivr](https://www.jsdelivr.com) CDN, so the page needs network access and a [content security policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) that allows that origin. Pass `bundles` to serve the engine files yourself. An application that already runs DuckDB-Wasm passes `{ duckdb, connection }` to share it.

`vacp.data_sql` reads two relations:

- `vacp_handle` holds the rows the marks read, after the chart's filters and calculations. When a hover is active, it holds the hovered rows. Otherwise the current selections narrow it.
- `vacp_all` holds every row the source loaded, before the chart's filters and aggregates.

`vacp.data_schema` describes `vacp_handle`, and `vacp_all` when the chart transforms its source.

Column types follow the chart's encodings. A field a continuous scale reads loads as `DOUBLE`, so a CSV column the chart plots as numbers sums and averages in SQL. Temporal fields load as `TIMESTAMP` holding wall-clock time on their axis's clock. A cell that names no number in a numeric field, or no date in a temporal one, loads as `NULL`.

A selection the adapter cannot translate to SQL, such as a point selection without fields, or a field the table lacks, makes the handle report `selectionError`. Its SQL queries then fail, so an agent never reads unfiltered rows while the chart shows a selection.

| `data` field | Default | Meaning                                                                        |
| ------------ | ------- | ------------------------------------------------------------------------------ |
| `duckdb`     |         | A `VacpDuckDbClient`, or a Promise of one                                      |
| `sql`        | `true`  | Register `vacp.data_sql`. `false` keeps handles and `vacp.data_schema`         |
| `describe`   |         | A hook that states row counts, `metadata`, and `stats` the chart does not hold |

Without `data`, the provider exposes parameters and selections and starts no database.

Try the [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/). The [API reference](../api/vega-lite) lists every option and operation parameter.
