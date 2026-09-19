# Build an inspection surface

`@vacp/inspector-core` connects custom interfaces to analytical sessions. It supplies coherent observations, operation execution, optional history, and graph lookups. Your application chooses what to display and how people interact with it.

## Connect a runtime

Given an installed VACP `runtime`, create a client and an inspection session:

```ts
import { createInspectorSession, createInspectionIndex } from '@vacp/inspector-core';
import { createRuntimeInspectorClient } from '@vacp/inspector-core/runtime';

const session = createInspectorSession(createRuntimeInspectorClient({ id: 'analysis', title: 'Analysis', runtime }), {
  historyLimit: 50,
});

const unsubscribe = session.subscribe(() => {
  const state = session.getState();
  if (!state.observation) return;
  const index = createInspectionIndex(state.observation);
  for (const node of state.observation.graph.nodes) {
    console.log(index.entity(node.ref));
  }
});
session.start();

// When this inspection surface closes:
unsubscribe();
session.dispose();
```

Construction and subscription perform no I/O. `start()` reads the source and subscribes to invalidations. Repeated starts are idempotent. `refresh()` also works independently for manual observation. Disposal aborts this session's requests and releases its source subscription. The application retains ownership of the analytical runtime.

`getState()` returns a stable reference until a state change. Use it with a framework's external-store binding, a DOM renderer, or another consumer. Register a subscriber before calling `start()`. Subscriber failures are isolated from requests and other subscribers.

## Read analytical context

The runtime connector reads `inspect()`, retaining unavailable catalog entries. Inspection does not bypass execution checks. An observation contains the graph, source ownership, values, summaries, and output freshness from one revision. Create an index for the observation your interface displays:

- `entity(ref)` returns the node, source, value, summary, freshness, incoming and outgoing edges, and related actions.
- `action(name)` returns the descriptor, owning source, availability, and prerequisites.
- `availableActions` contains only currently executable actions.
- Entity lookups also include availability, prerequisites, and dependent nodes.
- `source(id)` returns the source description.

Entity lookup distinguishes a missing state entry through `hasValue`. Related actions include declared inputs, affected entities, and result references. Dynamic reference parameters remain in each action's `operation.refParameters` for the application to resolve with its chosen inputs. Custom node kinds, layers, relationships, metadata, and operation schemas retain their protocol meaning.

Captured observations contain frozen plain records and arrays. Payloads may use JSON values and `undefined`. Dates become ISO strings, or `null` for invalid dates. Convert Maps, Sets, typed arrays, class instances, and circular structures to plain records or arrays in the client. Capture errors identify the incompatible value by path.

Build an index once per displayed observation. Selection, filtering, sorting, and navigation belong to your interface.

## Execute operations

Read executable descriptors from `createInspectionIndex(state.observation).availableActions`, collect parameters, and submit the protocol call:

```ts
const result = await session.execute({
  callId: crypto.randomUUID(),
  name: action.name,
  params,
});
```

This snippet assumes `action` and `params` come from your interface. The provider validates the parameters and executes the operation. Custom clients can use `InspectorClient<Params, Result>` to preserve their application types.

`state.operation` tracks the running call, captured result, or transport error. `state.observationError` reports observation failures independently. Each completed operation schedules a fresh observation. Its promise resolves with the result independently of that observation.

Execution passes native typed parameters to the client and returns its native result. `InspectionSnapshot<T>` describes the captured value, including date serialization. If a returned result cannot be captured, the operation state reports `capture-error` and the promise still resolves with the original result.

A session accepts one operation request at a time. Pass `{ signal }` to `execute`, `restore`, or `reveal` for cancellation. Cancellation stops waiting for a result and signals the client. It cannot undo a mutation already performed by the source.

## Retain observations

`historyLimit` bounds the number of changed revisions retained in `state.records`. It defaults to `0`. Records have session-local IDs and immutable observations. `clearHistory()` releases the retained list. An interface may hold a record after it leaves that list.

Displaying a recorded observation is a local UI choice. To restore analytical state, supply an explicit `client.restore` capability and call `session.restore(record.observation)`. A client may also implement `reveal(ref, options)` to locate an entity in its host. Read-only clients implement `observe` and optionally `subscribe`.

## Connect another surface

Implement `InspectorClient` for your host's transport. Its required fields are `id`, `title`, and `observe({ signal })`. Optional methods are `execute`, `subscribe`, `restore`, and `reveal`. The client identifies one analytical session. Create a new inspection session when switching owners.

For HTTP:

```ts
import { createInspectorSession } from '@vacp/inspector-core';
import { connectHttpInspectorClient } from '@vacp/inspector-core/http';

const client = await connectHttpInspectorClient({
  url: 'http://127.0.0.1:8796/api/vacp',
  intervalMs: 1000,
});
const session = createInspectorSession(client);
session.start();
```

The connector obtains the server identity from `/session` and sends it on every observation and operation. A changed server session requires reconnection. Polling runs while the client has subscribers and pauses while observations are in flight. Disable it with `intervalMs: 0`. Inject `fetch` to configure credentials or request headers. Pass `signal` to cancel the initial connection.

Python applications can expose a composed provider session:

```python
from vacp.http import create_inspection_app

app = create_inspection_app(composer, title='Analysis')
```

Install `vacp[http]` and mount the returned ASGI application in your server. The host owns authentication, allowed origins, and provider lifetime. Session identity guards against accidentally retargeting requests after a restart. It is not authentication.

For another wire transport, import `parseObservation` and `parseActionResult` from `@vacp/protocol/validation` to validate incoming payloads.
