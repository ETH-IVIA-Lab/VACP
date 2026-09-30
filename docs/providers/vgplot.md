# VGPlot

`@vacp/adapter-vgplot` exposes Mosaic VGPlot marks, selections, interactors, input widgets, legends, and tables.

Bind an existing rendered visualization, then compose its provider into a runtime:

```ts
import { createVgplotProvider } from '@vacp/adapter-vgplot';
import { createVacpRuntime } from '@vacp/runtime';

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

The provider recognizes interactors, legend toggles, and input widgets by their Mosaic classes from `@uwdata/mosaic-plot` and `@uwdata/mosaic-inputs`, so discovery works the same in development and in minified production builds. Both are peer dependencies. Install the versions that `@uwdata/vgplot` uses, so the application bundles one copy. An interactor from a second copy fails provider creation with an error that names the package.

Supply `root` to discover dashboard input widgets. Explicit plots and tables can be bound independently of a containing DOM node.

The runtime owns the attached provider's lifetime. Provider subscriptions observe human interactions and release listeners when detached. Disposing the provider leaves the visualization available to its host.

Action names are qualified by source identity. Discover an action through its `operation.contract` (for example, `vgplot.set_interval_1d`), then execute the advertised `name`. Graph ownership identifies the source when several providers offer the same contract.

Applications can expose the same provider through `installVacpRuntime({ providers: [provider], exposeBridge, injectDomSnapshot })` from `@vacp/runtime-browser`. Exposure policy belongs to the application.

Encoded fields contain bounded semantic descriptors: column and bin metadata, or native SQL text. Renderer objects and coordinator caches are excluded, so live rendering does not change field identity.

For dashboards, supply several `plots` and optional `tables`. Each plot supplies a `plotId` and the VGPlot object. Each table supplies a `tableId` and the table object.

Actions update existing Mosaic selections so linked views respond through their usual dataflow. Pass `options.duckdbClient` to expose data queries through the dashboard's database connection. Set `enableSql: false` to retain schema discovery while omitting SQL execution.

The adapter offers one data handle per table its marks and table views read. A handle's `vacp_handle` holds that table's rows narrowed by each selection that filters a view of the table through `filterBy`, and its state reports that predicate as `selectionWhere`. A selection that only highlights, or that filters views of another table, leaves the handle alone.

Mosaic reports no revision for the tables it reads, so a handle's `rowCount` is `null` unless the host states it through `options.describeDataHandle`. A host whose tables stay as they loaded, as they do once `astToDOM` has loaded a spec's data, can count each table once:

```ts
import { countDuckDbTablesOnce } from '@vacp/data-duckdb';

createVgplotProvider({
  plots,
  options: { appId, viewId, duckdbClient, describeDataHandle: countDuckDbTablesOnce(duckdbClient) },
});
```

The hook runs on every graph and state read, with the handle's `ref` and `table`, and returns any of `rowCount`, `metadata`, which joins the node's `data`, and `stats`, which join its state. A hook that fails states nothing.

Interval actions take data-domain endpoints in either order. Mosaic crossfilters retain the source plot as context and filter other marks subscribed through `filterBy`. In NYC Taxi Rides, brushing pickups filters the dropoff map. The hour histogram controls both maps but remains unfiltered itself. A visible brush identifies the selected region. Check the linked output to see the filtering effect.

Each interactor's `selectionValue` describes its own selection clause, with `null` for an inactive clause. Setting a time range preserves existing spatial crossfilters. Clear actions explicitly remove the targeted brush, so agents should preserve unrelated selections unless the user requests their removal.

For restoration, the adapter records each shared native Mosaic selection once as a `Selection` state entry. Its `activeSource` is the stable ref of the bound interaction that supplied the active clause, or `null` when none is active. Mosaic uses this identity to render crossfilters even when the clause values are unchanged. Restoration applies clause values before restoring the recorded active source.

When the native active source has no bound ref, `activeSource` is `undefined` and is omitted in JSON. Restoration reports that selection entry as skipped. Inspect the provider result when exact restoration is required. An unknown supplied source ref fails preparation before mutation.

Categorical legends expose their shared visible selection and support state restoration. Table sorting uses native schema columns and waits for Mosaic to update its rows. Presence bindings locate legend entries and sort headers directly.

Try the [VGPlot gallery](https://examples.vacp.dev/vgplot/).
