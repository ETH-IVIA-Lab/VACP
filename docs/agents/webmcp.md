# WebMCP

[WebMCP](https://webmachinelearning.github.io/webmcp/) is a proposed browser API through which a page registers tools for agents that run in the browser. `@ethivia/vacp-webmcp` registers every available VACP operation as a tool on `document.modelContext`. Calls run through the VACP runtime, so presence, provenance, and availability checks apply as they do for any other agent.

```ts
import { installVacpWebMcp } from '@ethivia/vacp-webmcp';

const webmcp = await installVacpWebMcp(runtime, {
  onError: (cause) => console.error('WebMCP registration failed', cause),
});

// When the view unmounts:
webmcp?.dispose();
```

`installVacpWebMcp` resolves to an installation once the first registration completes, or to `undefined` when the browser has no `document.modelContext`. A failed first registration rejects the promise. The runtime does not need to be exposed at `window.__vacp`.

## Tools

| Tool                 | Input                                      | Result                                                     |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `vacp.observe`       | none                                       | One observation: graph, state, revision, and freshness     |
| `vacp.capabilities`  | The `vacp_capabilities` scope fields       | The graph, scoped as requested                             |
| `vacp.state`         | `since`, `refs`, `includeSummary`          | A full state read with its token, or a delta since `since` |
| `vacp.progress`      | `message`, `done`                          | Shows one sentence to the person watching                  |
| `vacp.action.<name>` | The operation's parameters and `narration` | The operation's result envelope                            |

Each available operation is its own tool, so the graph that `vacp.observe` and `vacp.capabilities` return leaves operations out. An operation tool takes the operation's parameters directly, with `narration` beside them, when its schema is a plain object schema. A schema that is not an object, has a `narration` property, references other schemas with `$ref`, or constrains the whole object, such as with `additionalProperties`, keeps its parameters under `params`:

```json
{ "params": "hello", "narration": "Searching for hello." }
```

A call whose `narration` is missing, blank, or longer than 280 characters returns `{ callId, ok: false, error: { message } }` and runs nothing. Errors arrive as results so the agent can read the message and retry, since browsers replace a thrown tool error with a generic one.

## Options

| Option      | Default                 | Meaning                                                         |
| ----------- | ----------------------- | --------------------------------------------------------------- |
| `actor`     | `vacpAgentActor`        | Attribution of every step and sentence                          |
| `namespace` | `"vacp"`                | Prefix of every tool name, so several runtimes can share a page |
| `onError`   |                         | Receives a failed registration after a capability change        |
| `signal`    |                         | Removes the tools when aborted                                  |
| `context`   | `document.modelContext` | The registry to register into                                   |

Tool names allow letters, digits, underscores, hyphens, and dots. A name that collides with another owner's tool fails registration and replaces nothing.

## Changes and cleanup

The installation follows the runtime's capability changes. A tool whose definition is unchanged keeps its registration. A changed operation replaces its tool without cancelling a call already in progress. Revisions that arrive during a registration merge into the next one. `await webmcp.refresh()` waits until the current graph, or a newer one, is registered. `webmcp.error` holds the last automatic failure until a refresh succeeds.

`webmcp.dispose()` removes the tools and leaves the runtime running. Disposing the runtime also removes them.

A call that the agent cancels stops waiting, and the signal reaches the operation's handler. A handler that already applied its change keeps it, and a result that completed before the cancellation is still returned.

## Browser support

WebMCP is experimental. Chromium implements it behind flags: start Chromium with `--enable-experimental-web-platform-features --enable-features=WebMCPTesting`. See the [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) for other browsers. The browser suite runs the integration against Chromium's native `document.modelContext`.

Run the cars example and open it in a WebMCP-enabled Chromium:

```bash
pnpm --filter @ethivia/vacp-example-cars-parallel-coords dev
```

Open `https://cars-parcoords.examples.vacp.localhost/`. Every example registers its tools when the browser supports the API.
