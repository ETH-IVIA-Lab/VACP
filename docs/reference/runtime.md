# Runtime

`@vacp/runtime` composes analytical providers and records interaction history. It runs independently of the browser.

```ts
import { createVacpRuntime } from '@vacp/runtime';

const runtime = createVacpRuntime({ providers: [controls, chart, data] });
const observation = await runtime.observe();
```

## Provider contract

A `VacpProvider` exposes:

- `source`: stable source identity, type, title, and optional metadata.
- `observe()`: one atomic graph, state, summary, and freshness contribution.
- `prepare(call, options)`: validate and normalize an operation, returning its intent and a single-use `execute(options)` function.
- `subscribe(invalidate)`: optional push invalidation.
- `dispose()`: optional source cleanup.

`createVacpProvider({ source, actions, project })` builds this port for application integrations. `project()` owns the complete analytical graph, including action descriptors, plus state, summary, and freshness. The `actions` port prepares execution without changing that projection. Omit `revision` for a content-derived revision, or change it whenever any projected content changes. Browser installation and transports consume the provider through the same runtime contract.

## Composition and ownership

The runtime merges provider observations by stable refs and operation names. The composed graph records source descriptions plus node and action ownership.

Providers may add edges to nodes owned by another source. One source owns each node and operation. Duplicate owners and edges whose endpoints are missing fail observation.

`attachProviders(providers)` atomically adds or replaces a source group and returns a detach function. Detaching releases only sources still owned by that attachment, including when a newer attachment reuses the same provider instance. `removeProvider(sourceId)` removes one source. `update({ providers, sessionKey })` replaces the complete source set for a new application session.

## Coherent observations

`observe()` returns a `VacpObservation` with:

- `revision` and `observedAt` for the composed read.
- `graph.sources` and `graph.ownership`.
- analytical `state` and bounded `summary` values keyed by refs.
- per-output `freshness` records when a provider tracks stale, running, current, or failed outputs.

The composer retries when a provider invalidates while sources are being read. Each provider owns its settlement boundary and must invalidate consumers when its observation changes. This coordinates source observations rather than creating a transaction across independent engines. A notebook provider can wait for reactive execution, while a widget provider can wait for Python validation and trait observers.

`getCapabilities()` and `getState()` are scoped views derived from provider observations. Use `observe()` when graph, state, ownership, and freshness must share a revision.

## Provenance and explicit restoration

`getProvenance()` synchronously returns a frozen `{ runtimeId, sessionKey, epoch, revision, limit, records }` snapshot. Records are captured once and deeply frozen, so every reader and subscriber shares them and none can alter what another sees. `limit` is the retention bound; a consumer that mirrors events applies the same bound. `subscribeProvenance(listener)` receives `{ epoch, revision, record }` events. A `null` record marks a reset to a new epoch. `inspect()` reads the complete live observation independently of this journal.

Records are discriminated by `kind`: `action`, `observation`, `session`, or `turn`. A `turn` record marks the end of an agent turn, with its `activityId`, `outcome`, `opening` sentence, and closing sentence in `message`; each execution of the turn carries the same `activityId`. An action retains its call, result, terminal execution with the step's `narration`, and available before/after observations. Its actor belongs to `execution.actor`. Observation and session records carry their actor directly. Use the accessors in `@vacp/provenance-core` when consuming multiple record kinds.

Before-state capture occurs after preparation and execution gates, immediately before effects. Failed or cancelled operations retain their outcome. A failed observation read leaves that observation absent. If a result payload cannot be cloned, its journal envelope preserves the outcome and reports omitted payload data in `captureErrors`. The caller still receives the original result.

Recording retains the most recent 256 records by default. `historyLimit` accepts a positive safe integer. The runtime owns retention, and session changes clear the journal. `refresh({ actor, message, focus })` records explicit host attribution after an application change. Unattributed observations use a system actor. An observation concurrent with effects records the active execution identities as coincidence evidence, not proof of causation. See [provenance](../provenance/) for checkpoint projection and viewer lifecycles.

To restore a chosen observation, create a host-owned restorer:

```ts
import { createVacpRestorer } from '@vacp/runtime';

const recorded = await runtime.inspect();
const restorer = createVacpRestorer(runtime);
const result = await restorer.restore(recorded.state);
```

Each source must expose an unambiguous `vacp.apply_state` operation. The restorer reads complete ownership through `inspect()`, so currently unavailable entities can be restored when their source permits it. It routes state by ownership and serializes its own requests. Restoration still executes through the runtime and requires an available `vacp.apply_state` action. It waits for all source results and reports partial failures. Each outcome identifies its `sourceId`, action name, and action result. Providers report read-only and transient refs that they skip. Ordinary actions continue to target the live application.

Restoration defaults to a human actor and stamps `execution.restoration` with a correlation ID and optional recorded entry ID. It remains in provenance while checkpoint projection excludes it from the original trail.

Caller cancellation and runtime lifetime are combined in the handler's `{ signal }` option.

`dispose()` aborts the runtime, releases provider subscriptions, stops observation, and disposes attached providers.

## Execution activity

`getActiveExecutions()` returns current pending executions. `subscribeExecutions(listener)` publishes action lifecycle events independently of provenance. `getProviderBinding(provider)` returns the current attachment identity and lifetime signal for local presentation bindings. The separate `VacpExecutionControl` port grants timing authority: `addExecutionGate(gate, { timeoutMs, stage })` installs a bounded presentation gate. `stage` defaults to `before`. `after` holds the completed result and cannot change its outcome. The method returns its removal function.

Applications continue to invoke `runtime.execute(call, options)`. The runtime prepares and executes the owned operation once. `options.narration` is the step's sentence for the person watching, at most 280 characters, and the execution carries it from acceptance.

```ts
await runtime.execute(
  { callId: 'c1', name: 'cohort.set_sex', params: { sex: 'female' } },
  { actor, narration: 'Keeping only female athletes.' },
);
runtime.narrate({ actor, message: 'Female athletes are in view.', done: true });
```

`runtime.narrate({ actor, message, done?, signal? })` speaks for an agent whose turns have no lifecycle of their own, such as a model calling a progress tool. The first sentence opens a turn, later sentences replace its words, and `done` closes it with its sentence. An agent actor's execution with no turn open opens one without an opening sentence, so every step of a request shares its `activityId`. A turn closes after 60 seconds with no sentence and no step starting or ending, once the actor has no execution in flight. It throws on a missing, blank, or over-long sentence. See [agent presence](../presence/) for actor attribution, presentation bindings, and custom viewers.

## Current capabilities and full inspection

`observe()`, capability reads, and state reads disclose only currently available entities and actions. `inspect()` returns the complete observation, including availability declarations. See [availability](../providers/availability) for prerequisites, execution guards, and inspection lookups. Provider `observe()` still supplies the complete source catalog. The runtime owns disclosure.
