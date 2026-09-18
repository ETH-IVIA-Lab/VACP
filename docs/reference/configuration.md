# Configure VACP

Choose capabilities and browser exposure when composing your application.

```ts
import { installVacp } from '@vacp/sdk';
import { installVacpInspector } from '@vacp/inspector';

const integration = installVacp({
  providers: [provider],
  exposeBridge: true,
  injectDomSnapshot: false,
});
const inspector = installVacpInspector();

// Release these installations when the application unmounts.
inspector.dispose();
integration.dispose();
```

`exposeBridge` publishes the runtime at `window.__vacp`. `injectDomSnapshot` publishes a JSON observation in the DOM. Both default to `true`. Set `globalKey` on the runtime and Inspector when using another window key.

Install the Inspector where you want its controls to appear. Its stored preferences cover panel position, size, selected module, and chat configuration.

## Data access

Vega-Lite and VGPlot adapters accept `enableSql: false` to omit the raw SQL action while retaining schema and selection access. Custom integrations choose which handlers to register through `createVacpActions()`.

## WebMCP

Call `installVacpWebMcp(integration.bridge)` to expose the runtime through the browser's WebMCP API. This installation has its own lifecycle. See [WebMCP](../transports/webmcp).

## Example contexts

The example applications provide named contexts for reproducible evaluation. This URL selection belongs to the examples, not the VACP library.

| URL                 | Agent access                           |
| ------------------- | -------------------------------------- |
| `?context=visual`   | Rendered interface                     |
| `?context=snapshot` | Interface and DOM observation          |
| `?context=semantic` | Runtime bridge                         |
| `?context=full`     | Bridge, DOM observation, and Inspector |
| `?context=guided`   | Full context with raw SQL disabled     |

The default is `full`. Example tests may set `globalThis.__vacpExampleOptions` before application startup to select explicit installation options.
