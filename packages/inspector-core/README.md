# @vacp/inspector-core

Build custom inspection surfaces from VACP observations and operations.

```ts
import { createInspectorSession, createInspectionIndex } from '@vacp/inspector-core';
import { createRuntimeInspectorClient } from '@vacp/inspector-core/runtime';

const client = createRuntimeInspectorClient({ id: 'analysis', title: 'Analysis', runtime });
const session = createInspectorSession(client, { historyLimit: 50 });
const unsubscribe = session.subscribe(() => {
  const { observation } = session.getState();
  if (observation) {
    const index = createInspectionIndex(observation);
    console.log(observation.graph.nodes.map((node) => index.entity(node.ref)));
  }
});
session.start();

// Release this consumer when its host closes.
unsubscribe();
session.dispose();
```

`runtime` is the application's VACP runtime. `InspectorClient` is the connection port. `createInspectorSession` owns requests, immutable JSON-shaped observations, optional bounded history, and separate operation and observation diagnostics. `createInspectionIndex` resolves entity context, source ownership, relationships, freshness, and related operations.

Hosts own selection, navigation, input editing, result presentation, and analytical resource lifetime. Implement a client for a custom transport, use `./runtime` for an in-process runtime, or connect with `connectHttpInspectorClient` from `./http`. Read-only clients need only observation. Restoration and reveal are optional capabilities.

See [Build an inspection surface](../../docs/inspector/index.md) for lifecycle, cancellation, history, HTTP, and protocol validation contracts.
