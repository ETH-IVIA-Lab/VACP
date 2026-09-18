# @vacp/runtime

Compose snapshot and action providers with history, replay, scoped reads, and state deltas. The runtime accepts structural ports and runs independently of the browser.

```ts
import { createVacpRuntime } from '@vacp/runtime';

const runtime = createVacpRuntime({ snapshots, actions });
const state = await runtime.getState();
runtime.dispose();
```

`snapshots` implements `VacpSnapshotProvider`, and `actions` implements `VacpActionExecutor`. `VacpActionRegistry` provides an action executor and registrar. Standard action helpers validate their common envelopes, while custom handlers validate application-specific parameters.

See the [runtime reference](../../docs/reference/runtime.md) and [browser adapter](../../docs/reference/browser.md).
