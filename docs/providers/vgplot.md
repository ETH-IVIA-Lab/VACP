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

Supply `root` to discover dashboard input widgets. Explicit plots and tables can be bound independently of a containing DOM node.

The runtime owns the attached provider's lifetime. Provider subscriptions observe human interactions and release listeners when detached. Disposing the provider leaves the visualization available to its host.

Action names are qualified by source identity. Discover an action through its `operation.contract` (for example, `vgplot.set_interval_1d`), then execute the advertised `name`. Graph ownership identifies the source when several providers offer the same contract.

Applications can expose the same provider through `installVacpRuntime({ providers: [provider], exposeBridge, injectDomSnapshot })` from `@vacp/runtime-browser`. Exposure policy belongs to the application.

For dashboards, supply several `plots` and optional `tables`. Each plot supplies a `plotId` and the VGPlot object. Each table supplies a `tableId` and the table object.

Actions update existing Mosaic selections so linked views respond through their usual dataflow. Pass `options.duckdbClient` to expose data queries through the dashboard's database connection. Set `enableSql: false` to retain schema discovery while omitting SQL execution.

Interval actions take data-domain endpoints in either order. Mosaic crossfilters retain the source plot as context and filter other marks subscribed through `filterBy`. In NYC Taxi Rides, brushing pickups filters the dropoff map. The hour histogram controls both maps but remains unfiltered itself. A visible brush identifies the selected region. Check the linked output to see the filtering effect.

Categorical legends expose their shared visible selection and support state restoration. Table sorting uses native schema columns and waits for Mosaic to update its rows. Presence bindings locate legend entries and sort headers directly.

Try the [VGPlot gallery](https://examples.vacp.dev/vgplot/).
