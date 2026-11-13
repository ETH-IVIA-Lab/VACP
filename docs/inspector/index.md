# Inspector

`@ethivia/vacp-sdk/inspector` connects your own interface, such as a debugging panel or a teaching view, to a running analysis. An inspector session reads the full graph, including unavailable nodes and actions with their reasons, runs actions, and keeps optional history. Your interface decides what to show.

```ts
import {
  createInspectionIndex,
  createInspectorSession,
  createRuntimeInspectorClient,
} from '@ethivia/vacp-sdk/inspector';

const client = createRuntimeInspectorClient({ id: 'analysis', title: 'Analysis', runtime });
const session = createInspectorSession(client);

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

`runtime` comes from `const { runtime } = installVacpRuntime(...)`, and `render` stands for your own drawing code. `id` and `title` name the session in your interface. `start()` reads the graph and follows its changes. `getState()` returns the same object until something changes, so React's `useSyncExternalStore` can read it directly. `dispose()` cancels the session's requests and leaves the runtime running.

## Look up an entity

Build one index for each observation you show:

- `index.entity(ref)` returns the node with its source, value, summary, freshness, edges, actions, availability, prerequisites, and dependents.
- `index.action(name)` returns an action's descriptor, owning source, availability, and prerequisites.
- `index.availableActions` lists the actions that can run now.

The [inspector reference](../api/inspector#createinspectionindex) lists every field.

## Run an action

```ts
const result = await session.execute({ name: 'threshold.set', params: { value: 42 } });
```

The provider validates `params` before anything changes. A session runs one action at a time, tracks it in `getState().action`, and reads the graph again when it finishes. Pass `{ signal }` to stop waiting. A change the provider already applied stays applied.

## Keep and restore history

```ts
import { createVacpRestorer } from '@ethivia/vacp-sdk';

const restore = createVacpRestorer(runtime);
const client = createRuntimeInspectorClient({ id: 'analysis', title: 'Analysis', runtime, restore });
const session = createInspectorSession(client, { historyLimit: 50 });
```

`historyLimit` sets how many changed observations `getState().records` keeps. Showing a recorded observation reads nothing from the runtime. `session.restore(record.observation)` applies a recorded observation through each source's `vacp.apply_state` action.

## Inspect a Python application

The `vacp` Python package serves composed providers over HTTP with the `http` extra:

```python
from vacp.http import create_inspection_app

app = create_inspection_app(runtime, title='Analysis')
```

`runtime` is your `Runtime`, and `app` serves it under `/api/vacp`. Run `app` in an [ASGI](https://asgi.readthedocs.io) server such as [Uvicorn](https://www.uvicorn.org). ASGI is the interface between Python web servers and applications. Then connect from the browser:

```ts
import { connectHttpInspectorClient } from '@ethivia/vacp-sdk/inspector';

const client = await connectHttpInspectorClient({ url: 'http://127.0.0.1:8796/api/vacp' });
```

The client polls every second while the session has subscribers. Pass `intervalMs: 0` to read only on `refresh()`, and `fetch` to add credentials. If the server restarts, requests fail until you connect a new client. Your server owns authentication and allowed origins. For any other transport, implement `InspectorClient` as the [inspector reference](../api/inspector#inspectorclient) describes.

## Next

- [Provenance and replay](../provenance/)
- [Inspector reference](../api/inspector)
