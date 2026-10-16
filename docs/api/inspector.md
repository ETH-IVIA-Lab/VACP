# @vacp/inspector-core

Sessions, graph indexes, and clients for custom inspection surfaces. The [Inspection surfaces guide](../inspector/) shows a complete surface.

## createInspectorSession

```ts
createInspectorSession(client: InspectorClient, options?: { historyLimit?: number }): InspectorSession
```

Creates a session for one client. Creating it and subscribing read nothing.

| Member                              | Behavior                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `start()`                           | Reads the source and follows its invalidations. Later calls do nothing                            |
| `refresh()`                         | Reads once                                                                                        |
| `getState()`                        | `{ status, observation, observationError, records, operation }`, the same object until it changes |
| `subscribe(listener)`               | Notifies on state changes. Listener failures are isolated                                         |
| `execute(call, { signal? })`        | Runs an operation through the client and resolves with its result                                 |
| `restore(observation, { signal? })` | Restores a recorded observation through the client's `restore`                                    |
| `reveal(ref, { signal? })`          | Asks the client's host to show an entity                                                          |
| `clearHistory()`                    | Releases retained records                                                                         |
| `dispose()`                         | Cancels requests and releases the subscription                                                    |

`status` is `idle`, `loading`, `ready`, `error`, or `disposed`. `historyLimit` defaults to 0 retained records. `operation.status` is `idle`, `running`, `complete`, `error`, or `capture-error`. One operation runs at a time. Invalidations during a read schedule one more read, and a superseded read never publishes.

## InspectorClient

```ts
interface InspectorClient {
  readonly id: string;
  readonly title: string;
  observe(options: { signal: AbortSignal }): Promise<VacpObservation>;
  execute?(call: VacpActionCall, options: { signal: AbortSignal }): Promise<VacpActionResult>;
  subscribe?(invalidate: () => void): () => void;
  restore?: VacpRestore;
  reveal?(ref: VacpRef, options: { signal: AbortSignal }): void | Promise<void>;
}
```

`observe` returns the complete catalog, including unavailable entities. One client is one analytical session.

### createRuntimeInspectorClient

```ts
import { createRuntimeInspectorClient } from '@vacp/inspector-core/runtime';

createRuntimeInspectorClient({ id, title, runtime, restore?, reveal? }): InspectorClient
```

Reads `runtime.inspect()`, executes through `runtime.execute`, and invalidates on each runtime snapshot.

### connectHttpInspectorClient

```ts
import { connectHttpInspectorClient } from '@vacp/inspector-core/http';

connectHttpInspectorClient({ url, intervalMs?, fetch?, signal? }): Promise<InspectorClient>
```

Connects to a [Python inspection endpoint](./python#inspection-endpoint). Reads the session identity from `/session` and sends it with every request. Polls every `intervalMs` (1000 by default) while the session has subscribers, and `0` turns polling off.

## createInspectionIndex

```ts
createInspectionIndex(observation: InspectionObservation): InspectionIndex
```

| Member             | Returns                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity(ref)`      | The node, `source`, `value`, `hasValue`, `summary`, `freshness`, `incoming` and `outgoing` edges, related `actions`, `availability`, `prerequisites`, and `dependents` |
| `action(name)`     | The descriptor, owning `source`, `availability`, and `prerequisites`                                                                                                   |
| `availableActions` | The operations that run now                                                                                                                                            |
| `source(id)`       | The source description                                                                                                                                                 |
