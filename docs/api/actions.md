# Actions and providers

These exports define a source's actions and wrap the source in a provider. [Custom provider](../custom-provider/) builds a complete provider.

```ts
import {
  createProviderSubscription,
  createSharedSubscription,
  createVacpActions,
  createVacpProvider,
  createVacpRefBuilder,
  executeVacpAction,
  registerVacpApplyStateAction,
  registerVacpWidgetOptionsAction,
  VacpActionError,
  VacpActionRegistry,
  type VacpActionBuilder,
  type VacpActionHandler,
  type VacpActions,
  type VacpAnalyticalProjection,
  type VacpProvider,
} from '@ethivia/vacp-sdk';
```

## createVacpActions

```ts
function createVacpActions(sourceId?: VacpSourceId): VacpActions;
```

Creates an empty [`VacpActions`](#vacpactions) registry.

- `sourceId`: qualifies every registered name as `source_<hash>.<name>`, so actions of composed sources never collide. Default: names stay as written.

Returns a [`VacpActions`](#vacpactions).

## VacpActions

```ts
class VacpActions extends VacpActionRegistry {
  operation(kind: VacpOperationKind, name: string, description: string): VacpActionBuilder;
}
```

A [`VacpActionRegistry`](#vacpactionregistry) that also defines actions with Zod parameters. Pass it as `actions` to [`createVacpProvider`](#createvacpprovider), and the provider publishes `actions.list()` as the graph's `actions`. Register standard actions on it with `registerVacp*Action`. `operation` starts a [`VacpActionBuilder`](#vacpactionbuilder) for one action of [kind](./protocol#vacpoperationkind) `kind`.

## VacpActionBuilder

```ts
interface VacpActionBuilder {
  title(text: string): VacpActionBuilder;
  contract(contract: string): VacpActionBuilder;
  requires(...refs: VacpRef[]): VacpActionBuilder;
  input(...refs: VacpRef[]): VacpActionBuilder;
  affects(...refs: VacpRef[]): VacpActionBuilder;
  produces(result: { role; ref?; kind?; mediaType?; description? }): VacpActionBuilder;
  // After params, focus and handle receive z.output<Schema>.
  params<Schema extends ZodType>(schema: Schema): VacpActionBuilder;
  focus(resolve: (params: unknown) => VacpFocus | undefined): VacpActionBuilder;
  handle<Result>(handler: VacpActionHandler<unknown, Result>): VacpActionDescriptor;
}
```

Builds one [`VacpActionDescriptor`](./protocol#vacpactiondescriptor) and registers it.

- `title(text)` sets `title`.
- `contract(id)` sets `operation.contract`, such as `vacp.apply_state`.
- `requires(...refs)` adds refs to `availability.requires`, without duplicates.
- `input(...refs)` appends refs to `operation.inputRefs`.
- `affects(...refs)` appends refs to `operation.affects`.
- `produces(result)` appends to `operation.results`.
- `params(schema)` sets `parameters` to the [Zod](https://zod.dev) schema's input JSON Schema and parses every call with the schema before anything changes. Parsing applies defaults, coercion, transforms, refinements, and asynchronous checks. Call it once, before `focus`.
- `focus(resolve)` maps the parsed parameters to the [`VacpFocus`](./protocol#vacpfocus) presence points at.
- `handle(handler)` registers the action and returns its descriptor, with the qualified name when the registry has a `sourceId`.

Errors:

- `params` throws when called twice, after `focus`, or with a schema JSON Schema cannot represent, such as `z.date()` or `z.custom()`.
- `handle` throws when the registry already holds the name.
- A call whose parameters fail the schema resolves to `{ ok: false, error: { message, details } }`, with `details` set to `{ code: 'invalid-params', issues }`. Each issue is `{ path, code, message }`, with `errors` per branch for a union failure and nested `issues` for a key or element failure. Issues never include submitted values.

```ts
import { createVacpActions } from '@ethivia/vacp-sdk';
import { z } from 'zod';

const actions = createVacpActions();
actions
  .operation('query', 'search', 'Search records')
  .params(z.object({ text: z.string().min(1), limit: z.number().int().max(100).default(10) }))
  .handle(async ({ text, limit }, { signal }) => {
    const response = await fetch(`/search?q=${encodeURIComponent(text)}&limit=${limit}`, { signal });
    return response.json();
  });
```

## VacpActionHandler

```ts
type VacpActionHandler<Params = unknown, Result = unknown> = (
  params: Params,
  context: VacpActionExecutionContext,
) => Result | Promise<Result>;
```

Applies one action. `params` holds the parsed parameters and `context` the [execution context](./protocol#vacpactionexecutioncontext): `context.actor` is the actor the call is attributed to, and `context.signal` aborts when the caller cancels or the provider is replaced. The return value becomes the result's `result`. A thrown error becomes `{ ok: false, error: { message, details? } }`, where `details` are a `VacpActionError`'s `details` or a thrown primitive.

## createVacpRefBuilder

```ts
function createVacpRefBuilder(ids: { appId: string; viewId: string; vizId?: string }): {
  root: VacpRef;
  ref(suffix?: string): VacpRef;
};
```

Builds [refs](./protocol#vacpref) under one root. `root` is `vacp://<appId>/<viewId>` or `vacp://<appId>/<viewId>/<vizId>`. `ref(suffix)` appends `suffix` with one `/` between, and returns `root` for an empty suffix or `/`.

```ts
createVacpRefBuilder({ appId: 'shop', viewId: 'orders' }).ref('selection/region');
// 'vacp://shop/orders/selection/region'
```

## createVacpProvider

```ts
function createVacpProvider<NodeData = Record<string, unknown>>(options: {
  source: VacpSourceDescription;
  actions: Pick<VacpActionRegistry, 'prepare'>;
  project: () => VacpAnalyticalProjection<NodeData> | Promise<VacpAnalyticalProjection<NodeData>>;
  subscribe?: (invalidate: () => void) => () => void;
  dispose?: () => void;
}): VacpProvider<NodeData>;
```

Builds a [`VacpProvider`](#vacpprovider) that reads its source through `project`.

- `source`: the [source description](./protocol#vacpsourcedescription). Its `id` must be unique in the runtime.
- `actions`: prepares calls, usually the registry from `createVacpActions`.
- `project`: returns one [`VacpAnalyticalProjection`](#vacpanalyticalprojection) per read.
- `subscribe`: calls `invalidate` when a later projection may differ for a reason nobody attributes, and returns a function that stops. The runtime records those changes as `system`. Default: no notifications.
- `dispose`: releases the source when the runtime detaches the provider. Default: nothing.
- `NodeData`: the type of every node's `data`. Default: `Record<string, unknown>`, so nodes may carry differently shaped `data`.

Returns the provider. Its `observe()` adds `observedAt` and, when the projection has no `revision`, a revision hashed from the graph, state, summary, and freshness.

## VacpAnalyticalProjection

```ts
type VacpAnalyticalProjection<NodeData = Record<string, unknown>> = {
  graph: {
    nodes: VacpNode<NodeData>[];
    edges?: VacpEdge[];
    actions?: VacpActionDescriptor[];
  };
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
  revision?: string;
};
```

One read of a source: its [graph fragment](./protocol#vacpgraph), where `edges` defaults to none and `actions` to what the provider's `actions` lists, state and summaries keyed by ref, [freshness](./protocol#vacpfreshness) of outputs, and an optional `revision` that changes whenever any of them changes.

## VacpProvider

```ts
interface VacpProvider<NodeData = Record<string, unknown>> {
  readonly source: VacpSourceDescription;
  observe(): Observed | Promise<Observed>;
  prepare(
    call: VacpActionRequest & { callId: string },
    options?: { signal?; actor?; narration?; restoration? },
  ): Promise<{
    intent: { focus?: VacpFocus; affects: VacpRef[] };
    execute(context: VacpActionExecutionContext): Promise<VacpActionResult>;
  }>;
  subscribe(invalidate: () => void): () => void;
  dispose?(): void;
}
// Observed: VacpAnalyticalProjection<NodeData> with revision: string and observedAt: string
```

The port the runtime composes. `observe()` returns one read with a required `revision` that changes whenever any other field changes. `prepare` validates a call and resolves its target without changing the source. The returned `execute` runs once and resolves to a [`VacpActionResult`](./protocol#vacpactionresult). The `options` of `prepare` are the [execution context](./protocol#vacpactionexecutioncontext) fields, with `actor` optional. A change that reaches `subscribe`'s `invalidate` without an action is recorded as an external observation.

## VacpActionRegistry

```ts
class VacpActionRegistry {
  constructor(sourceId?: VacpSourceId);
  register<Params, Result>(
    descriptor: VacpActionDescriptor,
    handler: VacpActionHandler<Params, Result>,
    preparation?: {
      parse: (value: unknown) => Params | Promise<Params>;
      focus?: (params: Params) => VacpFocus | undefined;
      affects?: (params: Params) => VacpRef[];
    },
  ): VacpActionDescriptor;
  list(): VacpActionDescriptor[];
  unregister(name: string): void;
  prepare: VacpProvider['prepare'];
}
```

Holds one source's actions. `createVacpActions` builds on it.

- `register` copies `descriptor`, qualifies its name when the registry has a `sourceId`, and returns the copy. `preparation.parse` validates raw parameters before anything changes, `focus` sets the step's focus, and `affects` adds refs to its intent. Throws on a duplicate name.
- `list` returns copies of every descriptor.
- `unregister` removes an action by its registered, qualified name.
- `prepare` parses a call and returns its single-use execution, as [`VacpProvider.prepare`](#vacpprovider) does. Throws `Unknown action: <name>` for an unregistered name, and rejects when `parse` rejects. The execution resolves to `{ ok: false }` when the handler throws.

## executeVacpAction

```ts
function executeVacpAction(
  provider: Pick<VacpProvider, 'prepare'>,
  call: VacpActionRequest & { callId: string },
  context: VacpActionExecutionContext,
): Promise<VacpActionResult>;
```

Prepares and executes one call on one provider, without the runtime's routing, availability checks, call ID assignment, or recording. Use it to test a provider.

- `context.actor`: the actor the handler receives, such as [`vacpAgentActor`](./runtime#actors).
- `context.signal`: cancels the call.

Returns the result. A failed preparation or handler resolves to `{ ok: false }`. Rejects with the abort reason when `context.signal` aborts.

## VacpActionError

```ts
class VacpActionError<Details = unknown> extends Error {
  constructor(message: string, details: Details);
  readonly details: Details;
}
```

A failure whose `details` reach the result unchanged, as `{ ok: false, error: { message, details } }`. `details` must be serializable.

## registerVacpApplyStateAction

```ts
function registerVacpApplyStateAction<Result>(
  registry: VacpActionRegistry,
  prepare: (state: Record<VacpRef, unknown>) => ApplyState | Promise<ApplyState>,
  options?: { affects?: VacpRef[]; description?: string },
): VacpActionDescriptor;
// ApplyState: (context: VacpActionExecutionContext) => Result | Promise<Result>
```

Registers [`vacp.apply_state`](./protocol#standard-contracts), which restores a state keyed by ref. Restoration and replay call it.

- `prepare`: receives a copy of the requested state and returns the function that applies it. Throw to reject a state before anything changes. Agents can call `vacp.apply_state` too, so reject every state the source's own actions refuse.
- `options.affects`: refs listed in `operation.affects`. The step's intent always adds the refs in the requested state.
- `options.description`: replaces the default description.

The action declares no prerequisites, so it stays available whatever else is unavailable. Returns the descriptor. Parameters other than `{ state: Record<VacpRef, unknown> }` fail with `invalid-params` details.

## registerVacpWidgetOptionsAction

```ts
function registerVacpWidgetOptionsAction(
  registry: VacpActionRegistry,
  handler: (
    params: { ref; offset; limit; query? },
    context: VacpActionExecutionContext,
  ) => VacpWidgetOptionsResult | Promise<VacpWidgetOptionsResult>,
  options?: { availability?: VacpAvailability; inputRefs?: VacpRef[]; description?: string },
): VacpActionDescriptor;
```

Registers [`vacp.widget_options`](./protocol#standard-contracts), which pages through a menu's options. The handler receives `offset`, an integer of at least 0 with default 0, `limit`, an integer from 1 to 2,000 with default 200, and `query`, a filter of at most 200 characters. - `options.availability`: the action's [availability](./protocol#vacpavailability). Default: available.

- `options.inputRefs`: the inputs whose options it lists.
- `options.description`: replaces the default description.

Returns the descriptor.

## createSharedSubscription

```ts
function createSharedSubscription<Resource extends object>(
  connect: (resource: Resource, invalidate: () => void) => () => void,
): (resource: Resource, listener: () => void) => () => void;
```

Shares one native connection per resource among listeners. The returned function calls `connect` for the first listener of a resource, and calls its disconnect after the last listener leaves. A listener that throws reaches neither the source nor the other listeners.

## createProviderSubscription

```ts
function createProviderSubscription(
  bind: (notify: () => void) => () => void,
  options: { quietMs: number },
): { subscribe(listener: () => void): () => void; dispose(): void };
```

Calls `bind` on the first listener and its release after the last listener leaves. Notifications within `quietMs` milliseconds of the first reach listeners once. A listener that throws reaches no other listener. `subscribe` throws after `dispose`, and rethrows a failure of `bind`.
