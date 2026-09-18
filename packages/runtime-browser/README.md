# @vacp/runtime-browser

Install and discover browser runtimes, resolve browser configuration, and publish DOM snapshots.

```ts
import { installVacpRuntime, getVacpBridge, uninstallVacpRuntime } from '@vacp/runtime-browser';

const runtime = installVacpRuntime({ snapshots, actions });
const bridge = getVacpBridge();
uninstallVacpRuntime();
```

Installation preserves runtime identity while replacing provider ports. See the [browser reference](../../docs/reference/browser.md) for configuration and lifecycle behavior.
