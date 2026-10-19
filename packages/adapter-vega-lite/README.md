# @ethivia/vacp-adapter-vega-lite

`@ethivia/vacp-adapter-vega-lite` exposes parameters, selections, encodings, and data handles from a [Vega-Lite](https://vega.github.io/vega-lite/) specification and its rendered [Vega view](https://vega.github.io/vega/docs/api/view/).

Bind an existing rendered visualization, then compose its provider into a runtime:

```ts
import { createVegaLiteProvider } from '@ethivia/vacp-adapter-vega-lite';
import { createVacpRuntime } from '@ethivia/vacp-runtime';

const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
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

Applications can expose the same provider through `installVacpRuntime({ providers: [provider], exposeBridge, injectDomSnapshot })` from `@ethivia/vacp-runtime-browser`. Exposure policy belongs to the application.

The IDs define stable references for the view and visualization. Parameter and selection actions operate on the supplied Vega view.

Pass the `view` and `vgSpec` returned by [vega-embed](https://github.com/vega/vega-embed), which renders Vega-Lite specifications into Vega views. The adapter reads the compiled dataflow the host rendered.

Supply `data: { duckdb: client, sql: true, describe }` to expose data handles, schema discovery, and SQL queries over a host-owned DuckDB connection. `duckdb` also accepts a Promise. `sql` defaults to true. Set `sql: false` to retain schema discovery while disabling query execution. The optional `describe` callback supplies metadata and row counts. Omit `data` for parameter and selection interaction alone.

`vacp_handle` uses the hovered rows when hover is active. Otherwise the current selections narrow it. Selection tuples retain field correlations and native unit resolution. Identity selections and fields absent from the loaded table make the affected data handle unavailable. Its state reports `selectionError`, and its SQL queries reject.

[Provider guide](../../docs/vega-lite/index.md) · [Runnable example](../../examples/vega-lite-gallery)
