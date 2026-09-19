# @vacp/runtime

Compose analytical providers with explicit ownership, coherent observations, history, and replay.

```ts
import { createVacpRuntime } from '@vacp/runtime';

const runtime = createVacpRuntime({ providers: [controls, chart, data] });
const observation = await runtime.observe();
```

A provider combines a source description, an atomic analytical projection, and operation execution. `composeVacpProviders()` merges providers, validates ownership, routes operations, and retries reads invalidated during observation. Its `read()` returns the full `inspection`, disclosed `observation`, and resolved `availability` together. Disclosure and execution use the same prerequisite resolution.

See the [runtime reference](../../docs/reference/runtime.md) and [provider composition](../../docs/providers/composition.md).
