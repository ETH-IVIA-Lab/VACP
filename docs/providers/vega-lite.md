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

Pass `options.duckdbClient` to reuse a data connection. Otherwise the provider creates a browser DuckDB instance when data is requested. Set `enableDuckDbDataHandle: false` to disable data handles, or `enableSql: false` to omit SQL execution while retaining schema discovery.

`includeSetSignalAction` enables arbitrary named Vega signal writes. It defaults to false. Enable it when signal writes belong to the application's action surface.

Try the [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/).
