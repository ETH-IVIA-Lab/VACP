# Inspection surfaces

`@ethivia/vacp-inspector-core` connects a custom interface, such as a debugging panel or a teaching view, to an analytical session. It reads the complete catalog, executes operations, keeps optional history, and indexes the graph for lookups. Your interface decides what to show and how people navigate it.

## Connect a runtime

```ts
import { createInspectionIndex, createInspectorSession } from '@ethivia/vacp-inspector-core';
import { createRuntimeInspectorClient } from '@ethivia/vacp-inspector-core/runtime';

const client = createRuntimeInspectorClient({ id: 'analysis', title: 'Analysis', runtime });
const session = createInspectorSession(client, { historyLimit: 50 });

const unsubscribe = session.subscribe(() => {
  const { observation } = session.getState();
  if (!observation) return;
  const index = createInspectionIndex(observation);
  render(observation.graph.nodes.map((node) => index.entity(node.ref)));
});
session.start();

// When the surface closes:
unsubscribe();
session.dispose();
```

Creating a session and subscribing perform no reads. `start()` reads the source and follows its changes, and repeated calls do nothing more. `refresh()` reads once. `dispose()` cancels the session's requests and releases its subscription, and leaves the runtime running.

`getState()` returns the same object until something changes, so React's `useSyncExternalStore` can read it directly. It holds `status`, the current `observation`, an `observationError`, the retained `records`, and the current `operation`.

## Read the graph

The runtime client reads `inspect()`, which keeps unavailable nodes and operations with their reasons. Index the observation your interface shows:

| Lookup                   | Returns                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `index.entity(ref)`      | The node, its source, value, summary, freshness, edges, related operations, availability, prerequisites, and dependents |
| `index.action(name)`     | The descriptor, owning source, availability, and prerequisites                                                          |
| `index.availableActions` | The operations that run now                                                                                             |
| `index.source(id)`       | The source description                                                                                                  |

`entity(ref).hasValue` tells a missing state entry from a present `undefined`. Build one index per displayed observation.

Captured observations are frozen plain records and arrays. Dates become ISO strings, or `null` for invalid dates. A client that returns Maps, Sets, typed arrays, class instances, or cycles fails capture with an error naming the path of the value.

## Execute operations

```ts
const result = await session.execute({ callId: crypto.randomUUID(), name: action.name, params });
```

The provider validates `params` and runs the operation. `state.operation` tracks the running call, its result, or a transport error, and each completed operation schedules a fresh read. A session runs one operation at a time. Pass `{ signal }` to `execute`, `restore`, or `reveal` to stop waiting. Cancellation signals the client and cannot undo a change already applied.

## History and restoration

`historyLimit` sets how many changed observations `state.records` keeps. It defaults to 0. Showing a recorded observation reads nothing from the source.

To restore one, give the client a `restore` capability and call `session.restore(record.observation)`. With the runtime client, pass the restorer:

```ts
const restorer = createVacpRestorer(runtime);
const client = createRuntimeInspectorClient({ id: 'analysis', title: 'Analysis', runtime, restore: restorer.restore });
```

A client may also implement `reveal(ref)` to scroll its host to an entity.

## Connect another source

Implement `InspectorClient` for any transport: `id`, `title`, and `observe({ signal })` are required, and `execute`, `subscribe`, `restore`, and `reveal` are optional. One client is one analytical session. Create a new inspector session to switch sessions.

For a Python application, serve the composed providers over HTTP and connect from the browser:

```python
from vacp.http import create_inspection_app

app = create_inspection_app(composer, title='Analysis')
```

```ts
import { connectHttpInspectorClient } from '@ethivia/vacp-inspector-core/http';

const client = await connectHttpInspectorClient({ url: 'http://127.0.0.1:8796/api/vacp', intervalMs: 1000 });
```

Mount `app` in an [ASGI](https://asgi.readthedocs.io) server such as Uvicorn, with the `vacp[http]` extra installed.

- The client reads the server's session identity from `/session` and sends it with every request, so a restarted server fails requests until the client reconnects.
- Polling runs while the session has subscribers. Pass `intervalMs: 0` to turn it off.
- Pass `fetch` to add credentials.
- The host owns authentication and allowed origins. The session identity identifies the server process and grants no access.

To validate payloads from another transport, use `parseObservation` and `parseActionResult` from `@ethivia/vacp-protocol/validation`.
