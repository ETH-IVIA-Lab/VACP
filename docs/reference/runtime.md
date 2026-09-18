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
- `execute(call, options)`: semantic operation execution.
- `subscribe(invalidate)`: optional push invalidation.
- `dispose()`: optional source cleanup.

`createVacpProvider({ source, actions, project })` builds this port for application integrations. `project()` returns an analytical projection. Browser installation and transports consume the provider through the same runtime contract.

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

## History and replay

`getRuntime()` returns the current mode, cursor, history, live observation, and inspected observation. `subscribe(listener)` receives runtime entries.

`refresh({ source, message })` records an observation after an application change. `setCursor(index)`, `undo()`, and `redo()` inspect history. A provider that declares the `vacp.apply_state` operation contract can replay supported state into its application. Providers should report refs that cannot be restored.

Execution enters live mode before invoking an operation. Caller cancellation and runtime lifetime are combined in the handler's `{ signal }` option.

`dispose()` aborts the runtime, releases provider subscriptions, stops observation, and disposes attached providers.
