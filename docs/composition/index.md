# Compose sources

One runtime composes every [provider](../concepts/#provider) on a page, so an agent works across them through one [page bridge](../concepts/#page-bridge). The [Olympic athletes example](https://examples.vacp.dev/athletes/) composes a custom provider for its cohort controls, a [Vega-Lite](../vega-lite/) provider for one chart, and a [Mosaic vgplot](../vgplot/) provider for another.

```bash
pnpm add @ethivia/vacp-sdk zod
```

```ts
import { installVacpRuntime } from '@ethivia/vacp-sdk';

const { runtime } = installVacpRuntime({
  providers: [cohort, body, age],
  exposeBridge: true,
});
const observation = await runtime.observe();
```

`cohort`, `body`, and `age` come from `createVacpProvider`, `createVegaLiteProvider`, and `createVgplotProvider`. `observation.graph.ownership` records which source owns each node and action.

## Link entities across sources

A provider can add edges to nodes another source owns. Read the other provider's ref from its `observe()`, then declare the edge in your `project()`. Here `sports` is the ref of the cohort's sport control:

```ts
const { graph } = await body.observe();
const bodyView = graph.nodes.find((node) => node.kind === 'Visualization')!.ref;

// In the cohort provider's project():
edges: [{ from: sports, to: bodyView, kind: 'filters' }],
```

A duplicate ref, a duplicate action name, or an edge to a missing node fails the read with an error naming the conflict.

Declare `controls`, `derivedFrom`, or a kind of your own such as `filters` when one entity changes or feeds another. Agents follow these edges to find the control that changes a chart.

## Find an action by contract

Action names are unique across the graph. `createVegaLiteProvider` and `createVgplotProvider` prefix theirs with a hash of the source ID. Pass a source ID to `createVacpActions(sourceId)` for the same prefix, or choose unique names yourself.

Sources can implement one shared [contract](../concepts/#action) under different names. To find the SQL action for a [data handle](../concepts/#data-handle) with the ref `handleRef`, match the contract and the input:

```ts
const sql = observation.graph.actions.find(
  (action) => action.operation.contract === 'vacp.data_sql' && action.operation.inputRefs?.includes(handleRef),
);
```

## Call `invalidate` only on change

If a provider calls `invalidate` during a read, the runtime reads again. After eight attempts the read fails with `VACP sources did not settle into one coherent observation`, so never call `invalidate` from `project()`.

## Add and replace sources

`installVacpRuntime` keeps one runtime per `globalKey`, and a later call attaches its providers to that runtime. A provider with an existing source ID replaces that source and cancels its pending calls. A changed `sessionKey` replaces every source and starts a new provenance session.

Each installation's `dispose()` releases only the providers it attached. The last `dispose()` removes the runtime and `window.__vacp`.

Outside the browser, use `createVacpRuntime({ providers })` and `runtime.attachProviders(providers)`, which returns a function that detaches them. The [runtime reference](../api/runtime) lists every option.
