# Configure VACP

Choose capabilities and browser exposure when composing your application.

```ts
import { installVacp } from '@vacp/sdk';

const integration = installVacp({
  providers: [provider],
  exposeBridge: true,
  injectDomSnapshot: false,
});
```

`exposeBridge` publishes the runtime at `window.__vacp`. `injectDomSnapshot` publishes a JSON observation in the DOM. Both default to `true`. Set `globalKey` when publishing under another window key.

Use [Inspector Core](../inspector/) to connect a custom inspection surface to the analytical session.

## Data access

Vega-Lite and VGPlot adapters accept `enableSql: false` to omit the raw SQL action while retaining schema and selection access. Custom integrations choose which handlers to register through `createVacpActions()`.

## WebMCP

Call `installVacpWebMcp(integration.bridge)` to expose the runtime through the browser's WebMCP API. This installation has its own lifecycle. See [WebMCP](../transports/webmcp).

## Example applications

`examples/config.ts` owns the example applications' exposure and SQL settings. The defaults enable the runtime bridge, DOM observation, SQL, and WebMCP. Browser tests can supply explicit options through `globalThis.__vacpExampleOptions` before startup.
