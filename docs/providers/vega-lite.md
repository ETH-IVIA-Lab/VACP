# Vega-Lite

`@vacp/adapter-vega-lite` exposes parameters, selections, encodings, and data handles from a Vega-Lite specification and its rendered Vega view.

Bind an existing rendered visualization, then compose its provider into a runtime:

```ts
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVacpRuntime } from '@vacp/runtime';

const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  options: { appId: 'analysis', viewId: 'overview', vizId: 'scatter' },
});
const runtime = createVacpRuntime({ providers: [provider] });
const observation = await runtime.observe();

// When this analytical session ends:
runtime.dispose();
```

Supply `root` to place tooltips over the rendered chart. Observation and parameter execution also work with the Vega view alone.

The runtime owns the attached provider's lifetime. Provider subscriptions observe human interactions and release listeners when detached. Disposing the provider leaves the visualization available to its host.

Action names are qualified by source identity. Discover an action through its `operation.contract` (for example, `vega_lite.set_param`), then execute the advertised `name`. Graph ownership identifies the source when several providers offer the same contract.

Applications can expose the same provider through `installVacpRuntime({ providers: [provider], exposeBridge, injectDomSnapshot })` from `@vacp/runtime-browser`. Exposure policy belongs to the application.

The IDs define stable references for the view and visualization. Parameter and selection actions operate on the supplied Vega view.

`vega_lite.set_selection` sets an interval selection from `[min, max]` ranges keyed by channel or field. A channel left out of a multi-channel brush spans its scale's current domain, so `{ y: [1.9, 2.25] }` on an `x`/`y` brush selects that height band across every weight, like a full-width drag. A time axis takes ISO dates or timestamps. A date such as `"2012-06-01"` means midnight, and a time without an offset is wall-clock time, both on the axis's clock: local for `time` scales and UTC for `utc` scales. Text ending in `Z` or an offset names its instant. A point selection on a temporal field takes the same dates.

A range is rejected before the selection changes when it is not two numbers or dates, or when it misses the axis domain. The error states the domain in the axis's terms. An interval bound to its scales pans and zooms, so it takes any range, and restoring captured state applies its ranges as captured. A `monthdate` axis folds every year onto 2012, so `{ x: ["2014-06-01", "2014-08-31"] }` fails with the axis span, and `{ x: ["2012-06-01", "2012-08-31"] }` selects June through August of every year.

`vega_lite.hover_tooltip` points at the marks whose data match `fields` and reports the tooltip shown and how many marks match. When nothing matches, the result lists the named marks, their types, how many items each draws, and the fields their data carry. Pass one of those names as `markName` to match a single mark.

Selection state includes a readable resolved `value` and, when the native selection store is available, captured `tuples`. The tuples preserve native unit identity and correlations between selected fields, including selections resolved by intersection across views. `vacp.apply_state` restores captured tuples when present. Retain the complete selection state when saving observations for replay, since the resolved value alone can lose those relationships.

Restoration validates the complete parameter map, then updates native stores, variables, and brush geometry in one Vega evaluation. Linked marks observe the restored parameters together.

The adapter owns this representation and its native restoration. Provenance records it as ordinary provider state. A resolved intersected point selection without captured tuples is rejected when its native selection cannot be reconstructed.

Each data handle answers `vacp.data_sql` over two relations. `vacp_handle` holds the rows the chart's marks read, after its filters and calculations, narrowed by the current selections and hover. `vacp_all` holds every row the source loaded, before the chart's filters and aggregates. When Vega-Lite runs a calculation inside the source dataset itself, the loaded rows carry its result. `vacp.data_schema` describes `vacp_handle`, and `vacp_all` under the `vacp_all` key when the chart transforms its source.

Temporal fields load as `TIMESTAMP` columns holding wall-clock time on their axis's clock, so the day a local time axis labels June 1 reads `2012-06-01T00:00:00.000` in results. A hover on a temporal field takes the same dates as a brush, and a value that names no date rejects the hover.

A field a continuous scale reads loads as a `DOUBLE` column, and so does the source field behind an aggregate or bin such a scale reads, so a CSV column the chart plots as numbers sums and averages in SQL. Each source types its own fields, so a field one layer plots as numbers keeps its text in another layer's source. A cell that names no date in a temporal field, or no number in a numeric one, loads as `NULL`. A filter that leaves the marks no rows leaves `vacp_handle` empty, with its columns, so `SELECT count(*) FROM vacp_handle` returns 0.

Pass `options.duckdbClient` to reuse a data connection. Otherwise the provider creates a browser DuckDB instance when data is requested. Set `enableDuckDbDataHandle: false` to disable data handles, or `enableSql: false` to omit SQL execution while retaining schema discovery.

`includeSetSignalAction` enables arbitrary named Vega signal writes. It defaults to false. Enable it when signal writes belong to the application's action surface.

Try the [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/).
