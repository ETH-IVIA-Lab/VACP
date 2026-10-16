# @vacp/runtime

Compose analytical providers with explicit ownership, coherent observations, history, and replay.

```ts
import { createVacpRuntime } from '@vacp/runtime';

const runtime = createVacpRuntime({ providers: [controls, chart, data] });
const observation = await runtime.observe();
```

A provider combines a source description, an atomic analytical projection, operation preparation, and an invalidation subscription. `composeVacpProviders()` merges providers, validates ownership, and retries reads invalidated during observation. Its `read()` returns the full `inspection`, disclosed `observation`, and resolved `availability` together. `runtime.execute(call, options)` routes each action to its owner, checks availability before and after preparation, and records the step. `getState(request)` answers with a token, and with the changes since `request.since` when that token is known. Unattributed changes enter the history only when a provider invalidates. `executeVacpAction(provider, call)` runs one action without runtime recording.

See the [runtime reference](../../docs/api/runtime.md) and [provider composition](../../docs/composition/index.md).
