# @ethivia/vacp-adapter-vgplot

`@ethivia/vacp-adapter-vgplot` exposes [Mosaic vgplot](https://idl.uw.edu/mosaic/vgplot/) marks, selections, interactors, input widgets, and tables.

Bind an existing rendered visualization, then compose its provider into a runtime:

```ts
import { createVgplotProvider } from '@ethivia/vacp-adapter-vgplot';
import { createVacpRuntime } from '@ethivia/vacp-runtime';

const provider = createVgplotProvider({
  root: svg,
  plots: [{ plotId: 'scatter', plot }],
  options: { appId: 'analysis', viewId: 'overview' },
});
const runtime = createVacpRuntime({ providers: [provider] });
const observation = await runtime.observe();

// When this analytical session ends:
runtime.dispose();
```

Supply `root` to discover dashboard input widgets. Explicit plots and tables can be bound independently of a containing DOM node.

The runtime owns the attached provider's lifetime. Provider subscriptions observe human interactions and release listeners when detached. Disposing the provider leaves the visualization available to its host.

Action names are qualified by source identity. Discover an action through its `operation.contract` (for example, `vgplot.set_interval_1d`), then execute the advertised `name`. Graph ownership identifies the source when several providers offer the same contract.

Applications can expose the same provider through `installVacpRuntime({ providers: [provider], exposeBridge, injectDomSnapshot })` from `@ethivia/vacp-runtime-browser`. Exposure policy belongs to the application.

For dashboards, supply several `plots` and optional `tables`. Each plot supplies a `plotId` and the vgplot plot object. Each table supplies a `tableId` and the table object.

Actions update existing Mosaic selections so linked views respond through their native dataflow. Each action targets a graph node with `{ ref, ...values }`. For example, `vgplot.set_interval_1d` takes `{ ref, min, max }`, and `vgplot.table_set_page` takes `{ ref, offset, limit }`. Selection state retains complete `selectionValue` values for restoration.

Supply `data: { duckdb: client, sql: true, describe }` to expose data handles, schema discovery, and queries over the dashboard's database. `duckdb` accepts a query client or a Promise. `sql` defaults to true. Set `sql: false` to retain schema discovery while disabling query execution. The optional `describe` callback supplies metadata and row counts. Omit `data` for interaction alone.

The adapter shares Mosaic's 0.33 plot, input, and SQL packages with the application. Mosaic coordinates linked views through native selections. Selection predicates use Mosaic's SQL translation, and a translation failure makes the affected data handle unavailable. Its state reports `selectionError`, and its SQL queries reject.

[Provider guide](../../docs/vgplot/index.md) · [Runnable example](../../examples/vgplot-gallery)
