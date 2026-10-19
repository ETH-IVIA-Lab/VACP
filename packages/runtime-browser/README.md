# @ethivia/vacp-runtime-browser

Install and discover composed browser runtimes, resolve browser configuration, and publish DOM observations.

```ts
import { getVacpBridge, installVacpRuntime } from '@ethivia/vacp-runtime-browser';

const installation = installVacpRuntime({ providers: [controls, chart], exposeBridge: true, injectDomSnapshot: false });
const runtime = installation.runtime;
const observation = await runtime.observe();
const bridge = getVacpBridge();

installation.dispose();
```

Applications choose `exposeBridge`, which publishes the runtime at `globalKey`, `__vacp` by default, and `injectDomSnapshot`, which publishes observations in script elements. Installation preserves runtime identity and composes providers by source ID. `getVacpBridge()` returns the published runtime when it carries the complete page bridge. See the [browser reference](../../docs/api/browser.md) for configuration and lifecycle behavior.
