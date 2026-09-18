# @vacp/runtime-browser

Install and discover composed browser runtimes, resolve browser configuration, and publish DOM observations.

```ts
import { getVacpBridge, installVacpRuntime } from '@vacp/runtime-browser';

const installation = installVacpRuntime({ providers: [controls, chart] });
const runtime = installation.runtime;
const observation = await runtime.observe();
const bridge = getVacpBridge();

installation.dispose();
```

Installation preserves runtime identity and composes providers by source ID. See the [browser reference](../../docs/reference/browser.md) for configuration and lifecycle behavior.
