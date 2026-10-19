# @ethivia/vacp-runtime

The runtime composes providers, executes operations, records provenance, and publishes agent activity. It runs in any JavaScript environment. [`@ethivia/vacp-browser`](./browser) installs one in a page.

## createVacpRuntime

```ts
createVacpRuntime(options: {
  providers: readonly VacpProvider[];
  sessionKey?: string;
  runtimeId?: string;
  historyLimit?: number;
}): VacpRuntime
```

Composes `providers` and subscribes to their invalidations. `historyLimit` bounds the provenance journal and defaults to 256 records. `runtimeId` defaults to a random ID. `sessionKey` names the analytical session. Throws when two providers share a source ID.

### Reads

| Method                      | Returns                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `observe()`                 | `Promise<VacpObservation>`: the available graph, state, summaries, freshness    |
| `inspect()`                 | `Promise<VacpObservation>`: the complete catalog with availability declarations |
| `getCapabilities(request?)` | `Promise<VacpCapabilitiesSnapshot>`, scoped by `VacpCapabilitiesRequest`        |
| `getState(request?)`        | `Promise<VacpStateUpdate>`: full with a token, or a delta since `request.since` |
| `getProvenance()`           | The frozen provenance snapshot                                                  |
| `getActiveExecutions()`     | Executions that have not settled                                                |
| `getAgentActivities()`      | Current public agent activity                                                   |

### Execution

```ts
runtime.execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>
```

Routes the call to the operation's owner, checks availability, prepares the call, waits for execution gates, checks availability again, and executes once. The actor defaults to `vacpAgentActor`. The result is `{ ok: false }` for an unknown or unavailable operation, invalid parameters, or a handler failure. Cancelling `options.signal` before execution prevents the change. Recording happens once, after the result is known, and a later failure never replaces that result.

```ts
runtime.refresh(options?: { actor?: VacpActor; message?: string; focus?: VacpFocus }): Promise<VacpStateSnapshot>
```

Reads the sources and records the change as an observation by `actor`, the system actor by default. Call it after a person changes the application.

### Agent activity

| Method                                             | Behavior                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `beginAgentActivity({ actor, summary?, signal? })` | Opens a turn. The handle's `update(summary)` replaces its words, `end({ outcome?, summary? })` closes it |
| `narrate({ actor, message, done?, signal? })`      | Speaks one sentence. Opens a turn when none is open, or joins the open one. `done: true` closes it       |

A summary is at most 500 Unicode code points, trimmed of the same whitespace as narration. A turn that `narrate` or a first step opened closes after 60 seconds with no sentence and no step, once the actor has no execution in flight. A turn opened with `beginAgentActivity` stays open until its handle ends it. An agent's first execution with no turn open opens one, so every step of a request shares one `activityId`. The runtime keeps at most 32 actors with an open turn. Opening a turn for another actor cancels the oldest one.

### Subscriptions

| Method                               | Publishes                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `subscribeProvenance(listener)`      | `{ epoch, revision, record }` for each record, `record: null` on a new session |
| `subscribeExecutions(listener)`      | Every `VacpExecution` phase                                                    |
| `subscribeAgentActivities(listener)` | Every activity change                                                          |
| `subscribeCapabilities(listener)`    | The capabilities snapshot when the graph changes                               |
| `subscribeSnapshots(listener)`       | `{ observation, capabilities, state }` after each read that changed            |

Each returns a function that removes the listener.

### Sources and lifecycle

| Member                                          | Behavior                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `attachProviders(providers)`                    | Adds or replaces sources by source ID and returns a function that detaches the ones this call attached |
| `update({ providers, sessionKey? })`            | Replaces every source. A changed `sessionKey` starts a new provenance epoch                            |
| `getProviderBinding(provider)`                  | `{ id, signal }` for the provider's current attachment. Replacing the provider aborts `signal`         |
| `addExecutionGate(gate, { timeoutMs, stage? })` | Adds a bounded wait `before` (default) or `after` execution. Returns its removal                       |
| `providerIds`                                   | The attached source IDs                                                                                |
| `runtimeId`, `sessionKey`                       | The runtime's identity and current session                                                             |
| `signal`                                        | Aborted by `dispose()`                                                                                 |
| `dispose()`                                     | Cancels pending calls, releases subscriptions, and disposes attached providers                         |

## createVacpProvider

```ts
createVacpProvider(options: {
  source: VacpSourceDescription;
  actions: Pick<VacpActionRegistry, 'prepare'>;
  project: () => VacpAnalyticalProjection | Promise<VacpAnalyticalProjection>;
  subscribe: (invalidate: () => void) => () => void;
  dispose?: () => void;
}): VacpProvider
```

Builds a provider from a projection. `project()` returns `{ graph: VacpGraphFragment, state, summary?, freshness?, revision? }` for one read. When `revision` is absent, the provider derives it from the projected content. Call `invalidate` whenever a later projection may differ.

## VacpActionRegistry

```ts
new VacpActionRegistry(sourceId?: VacpSourceId)
registry.register(descriptor, handler, preparation?): VacpActionDescriptor
registry.list(): VacpActionDescriptor[]
registry.unregister(name: string): void
registry.prepare(call, options?): Promise<VacpPreparedAction>
```

Holds one source's operations. With a `sourceId`, registered names are qualified as `source_<hash>.<name>`, so composed sources never collide. `preparation` is `{ parse, focus?, affects? }`: `parse` validates the raw parameters before anything changes. `register` throws on a duplicate name. `prepare` throws for an unknown operation. `@ethivia/vacp-sdk`'s `createVacpActions` builds on this registry.

`executeVacpAction(provider, call, options?)` prepares and executes a call on one provider without the runtime's routing, availability checks, or recording. Use it to test a provider.

## Standard operations

```ts
registerVacpApplyStateAction(registry, prepare, options?: { affects?; description? })
registerVacpDataSqlAction(registry, handler, options?: { availability?; inputRefs?; description? })
registerVacpDataSchemaAction(registry, handler, options?: { availability?; inputRefs?; description? })
registerVacpWidgetOptionsAction(registry, handler, options?: { availability?; inputRefs?; description? })
```

Each registers its [standard contract](./protocol#standard-contracts) with parameter validation and returns the descriptor. Invalid parameters fail with the same `invalid-params` details as `@ethivia/vacp-sdk` operations. `prepare` for `vacp.apply_state` receives the desired state and returns the function that applies it. Throw from `prepare` to reject a state before anything changes. `@ethivia/vacp-duckdb` provides the SQL and schema handlers.

### parseVacpParams

```ts
parseVacpParams<Schema extends ZodType>(action: string, schema: Schema): (value: unknown) => Promise<output<Schema>>
```

Returns a parser for a `VacpActionRegistry` registration's `parse` option. It resolves to the schema's output, or rejects with a `VacpActionError` whose `details` are `{ code: 'invalid-params', issues }`. Each `VacpParameterIssue` is `{ path, code, message }`, with `errors` per branch for a union failure and nested `issues` for a key or element failure. Submitted values never appear in the issues.

## createVacpRestorer

```ts
const restorer = createVacpRestorer(runtime);
restorer.restore(state: Record<VacpRef, unknown>, options?: VacpActionExecutionOptions): Promise<VacpRestorationResult>
```

Splits `state` by source ownership, read through `inspect()`, and executes each source's `vacp.apply_state` operation as `vacpHumanActor` unless `options.actor` names another. Requests through one restorer run one at a time. Every ref must have an owner with exactly one `vacp.apply_state` operation, checked before any source changes. A failed check returns `{ ok: false, error: { message } }` and applies nothing. After the check, sources restore independently. Success returns `{ ok: true, result: { sources } }`, and a failure in any source returns `{ ok: false, error: { message, details: { sources } } }`, both with one `{ sourceId, action, result }` per source. `restore` keeps no reference to the restorer, so pass it where a `VacpRestore` is expected.

## Subscription helpers

```ts
createSharedSubscription(connect: (resource, invalidate) => () => void): (resource, listener) => () => void
createProviderSubscription(bind: (notify) => () => void, options: { quietMs: number }): { subscribe(listener): () => void; dispose(): void }
```

`createSharedSubscription` connects a native resource once while it has listeners, and disconnects after the last leaves. `createProviderSubscription` binds lazily on the first listener, coalesces notifications within `quietMs`, and isolates listener failures.

## composeVacpProviders

```ts
composeVacpProviders(providers): { read(): Promise<VacpResolvedObservation>; subscribe(listener): () => void; dispose(options?): void }
```

Composes providers for a host that manages its own reads and execution. `read()` returns `{ inspection, observation, availability }` from one coherent read across the providers, retrying while a provider invalidates during the read.
