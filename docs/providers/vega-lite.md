# Vega-Lite

`@vacp/adapter-vega-lite` exposes parameters, selections, encodings, and data handles from a Vega-Lite specification and its rendered Vega view.

Given a rendered `view`, its `spec`, and the containing `root` element:

```ts
import { installVacpOnVegaLiteView } from '@vacp/adapter-vega-lite';

const bridge = installVacpOnVegaLiteView({
  root,
  view,
  spec,
  options: {
    appId: 'analysis',
    viewId: 'overview',
    vizId: 'scatter',
  },
});

const capabilities = await bridge.getCapabilities();
```

The IDs define stable references for the view and visualization. Parameter and selection actions operate on the supplied Vega view.

Inline datasets can be exposed through DuckDB-backed data handles. Pass `duckdbClient` to reuse a client. Otherwise the provider creates a browser DuckDB instance when needed. Set `enableDuckDbDataHandle: false` to disable that integration.

`includeSetSignalAction` enables arbitrary named Vega signal writes. It defaults to false. Enable it when signal writes are part of your application's intended action surface.

Try the [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/).
