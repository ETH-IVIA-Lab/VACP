# Compose sources

One runtime can compose any number of providers. The [Olympic athletes example](https://examples.vacp.dev/athletes/) composes three: a custom provider for its cohort controls, a Vega-Lite provider for the height and weight chart, and a vgplot provider for the age histogram.

```ts
import { installVacpRuntime } from '@ethivia/vacp-browser';

const { runtime, dispose } = installVacpRuntime({
  providers: [cohort, physique, age],
  sessionKey: 'athletes',
  exposeBridge: true,
  injectDomSnapshot: true,
});
const observation = await runtime.observe();
```

The observation holds every source's nodes, state, and operations, and `observation.graph.ownership` records which source owns each node and operation.

## Link entities across sources

A provider may add edges to nodes another source owns. The cohort provider declares that its sport control filters both charts:

```ts
edges: [
  { from: sports, to: physiqueRef, kind: 'filters' },
  { from: sports, to: ageRef, kind: 'filters' },
],
```

Composition checks that both ends of every edge exist and that each node and operation has exactly one owner. A duplicate ref, a duplicate operation name, or an edge to a missing node fails the observation with an error naming the conflict.

Containment alone carries no analytical meaning. Declare `controls` or `derivedFrom`, or a kind of your own such as the example's `filters`, when the application knows that one entity changes or feeds another. Agents follow these edges to find the control that changes a chart.

## Find an operation by contract

Each operation's `name` is unique across the composed graph, and the runtime routes a call to the operation's owner. The visualization adapters qualify their operation names with their source identity, so two Vega-Lite charts each offer their own selection operation. A custom provider passes its source ID to `createVacpActions(sourceId)` for the same qualification, or chooses names that are already unique.

Several sources can implement one shared contract under different names. To find the SQL operation for a data handle, match the contract and the handle:

```ts
const sql = observation.graph.actions.find(
  (action) => action.operation.contract === 'vacp.data_sql' && action.operation.inputRefs?.includes(handleRef),
);
```

## Read several sources at once

The runtime reads all providers for one observation. When a provider reports a change while the read is in progress, the runtime reads again, up to a fixed number of attempts. Each provider decides when its own values have settled: a Vega-Lite view after its dataflow runs, a vgplot dashboard after Mosaic renders.

Each provider's part of a read describes one moment in that provider. A change that lands in one source right after the read appears in the next observation.

## Add and replace sources

`installVacpRuntime` with providers whose source IDs are new adds them to the runtime at the global key. A provider with an existing source ID replaces that source and cancels calls still pending on the old binding. A changed `sessionKey` replaces the whole source set and starts a new provenance history. Each installation's `dispose()` releases only the providers it attached.

For a runtime outside the browser, `createVacpRuntime({ providers })` from `@ethivia/vacp-runtime` composes the same way, and `runtime.attachProviders(providers)` returns a function that detaches them.
