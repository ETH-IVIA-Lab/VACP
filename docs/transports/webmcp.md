# Expose VACP through WebMCP

`@vacp/transport-webmcp` projects a VACP graph into tools registered with `document.modelContext`. Actions still run through the VACP runtime, so the interface, state snapshots, and history remain shared with the user.

## Install

```ts
import { createVacpProvider, installVacp } from '@vacp/sdk';
import { installVacpWebMcp } from '@vacp/transport-webmcp';

const provider = createVacpProvider({ source, actions: actions.registry, project });
const integration = installVacp({ providers: [provider] });
const webmcp = await installVacpWebMcp(integration.bridge, {
  onError: (cause) => console.error('WebMCP registration failed', cause),
});
```

The call returns an installation handle, or `undefined` when the browser does not expose `document.modelContext`. It does not require `window.__vacp` to be exposed. Initial registration errors reject the promise. Registration errors identify the failed tool and retain the browser error as their cause.

By default, agents discover:

| Tool                        | Result                                                                          |
| --------------------------- | ------------------------------------------------------------------------------- |
| `vacp.observe`              | One coherent graph, state, ownership, revision, and freshness observation.      |
| `vacp.capabilities`         | The live graph, including entities, edges, references, and action descriptions. |
| `vacp.state`                | Current state and summaries keyed by graph references.                          |
| `vacp.progress`             | Shows one plain sentence to the person in the agent's presence bubble.          |
| `vacp.action.<action-name>` | The result of the corresponding VACP action, narrated by its own sentence.      |

Every action tool requires a `narration` field next to the action's parameters: this step's own sentence for the person. The adapter passes it to the runtime as the step's `narration`, which the execution carries from acceptance, so the presence bubble shows it as the step begins. An action whose parameters already use the name `narration`, or whose schema root is not an object, moves its parameters under `params`.

`vacp.progress` is registered when the source publishes agent activity, as the VACP runtime does. The agent calls it once before the first action and again with `done: true` and a closing sentence. The progress tool speaks through the runtime's narrator for the WebMCP actor, so its turn and the narrated actions share one public activity: the first sentence opens it, later sentences replace its text, and `done: true` closes it. A turn with no sentence or step for 60 seconds closes once no step of the actor is in flight. See [agent presence](../presence/#report-thinking-and-public-progress).

An action's related nodes supply context for its tool description. Its existing parameter schema is reused. The adapter does not infer handlers from graph nodes or create a separate application action registry.

## Inputs and results

Schemas with an explicit `type: 'object'` pass inputs directly to the action. For an action named `threshold.set`, an agent calls `vacp.action.threshold.set` with `{ "value": 42 }`.

Other schemas, including unions, nullable objects, and root `$ref` schemas, use a `params` envelope. For an action accepting a string, the tool input is `{ "params": "hello" }`. The nested schema retains its own schema resource for local references. Use `inputMode: () => 'object'` to place `narration` beside the properties of an object schema that automatic detection would wrap, or `'params'` to require an envelope. Object mode requires an object root without its own `narration` property, and compilation throws otherwise. Actions without a schema accept object inputs by default.

An envelope requires an explicit `params` value, including `null` when accepted. To expose optional values or defaults through WebMCP, place them in object properties, for example `.params(z.object({ limit: z.number().default(10) }))`. Agents can then invoke the action with `{}`.

Handlers retain responsibility for validation. The action result is the normal VACP envelope: `{ callId, ok, result }` or `{ callId, ok: false, error }`. No source files or schemas are generated from TypeScript types.

A call whose `narration` is missing, blank, or longer than 280 characters returns `{ callId, ok: false, error: { message } }` and does not run the action. `vacp.progress` answers an unusable `message` or `done` with `{ ok: false, error: { message } }`. Both arrive as results so the agent can read the message and retry: Chromium replaces an error thrown by a tool with a generic one.

## Select and customize tools

```ts
const webmcp = await installVacpWebMcp(integration.bridge, {
  namespace: 'chart',
  includeAction: (action) => action.name !== 'internal.reset',
  annotations: (action) => ({ readOnlyHint: action.operation.contract === 'vacp.data_schema' }),
});
```

`namespace` allows several runtimes to share a document. `actionName` can override each action's full tool name; WebMCP requires 1–128 ASCII letters, digits, underscores, hyphens, or dots. Name collisions fail registration instead of replacing another owner's tools.

`includeAction` limits the direct tool catalog. The capabilities reader still returns the source graph; this option is not an authorization mechanism. Applications enforce their own action permissions and validation.

Pass `signal` to tie the installation to an application lifetime. Pass `context` to register against an explicitly supplied WebMCP host. Pass `exposedTo` to use WebMCP's origin exposure options; omitting it preserves the browser's defaults.

## Changes and cleanup

The installer follows `runtime.subscribeCapabilities()`. Runtime refreshes, provider replacement, and observation publish changes to the live graph. Historical viewer selection leaves the exported catalog live. Unchanged tool definitions keep their registrations. Replacing metadata withdraws the old registration without cancelling a call already in progress.

Waiting graph revisions are merged into the latest catalog; an in-progress registration finishes before the next catalog is applied. Call `await webmcp?.refresh()` to explicitly re-read and wait for that catalog, or a newer queued revision, to finish registering. Automatic failures are available as `webmcp.error` and sent to `onError`. A failed update withdraws owned tools; a successful refresh clears the error and restores registration.

`webmcp?.dispose()` stops exposure while leaving the runtime available. Disposing the runtime also removes its WebMCP tools. Each registration uses its own abort signal; unrelated document tools remain registered.

WebMCP cancellation reaches the action handler's execution context:

```ts
actions.operation('query', 'search', 'Search records').handle(async (params, { signal }) => {
  const query = searchParams.parse(params);
  const response = await fetch(`/search?q=${encodeURIComponent(query.text)}`, { signal });
  return response.json();
});
```

Cancellation prevents an already-aborted call from starting. Long-running handlers must cooperate with the signal; cancellation does not undo application changes.

## Browser support and example

This integration targets the [September 17, 2026 WebMCP draft](https://webmachinelearning.github.io/webmcp/), specifically its document-scoped, asynchronous registration API. Browser support is experimental; consult the project's [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md). Earlier navigator-scoped APIs are not supported.

Run the parallel-coordinates example in a browser with WebMCP enabled:

```bash
pnpm --filter @vacp/example-cars-parallel-coords dev
```

Open `https://cars-parcoords.examples.vacp.localhost/`. The example registers WebMCP tools when the browser supports the API.

The browser suite exercises native `document.modelContext` registration and invocation in Chromium 153 with experimental Web Platform features enabled, including provider replacement and disposal. Its experimental caller API currently takes serialized JSON input, whereas the newer draft describes object input. This difference is confined to the browser test; the integration only implements tool provision.

Browser-supplied execution context is optional. When the browser provides a cancellation signal, VACP combines it with the runtime lifetime. Runtime and provider disposal remain effective for calls that arrive without a browser signal.
