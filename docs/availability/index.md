# Declare availability

Availability hides what can't run yet from agents and rejects calls to it. A provider publishes its complete catalog of nodes and actions, and agent reads return only the entries the current state allows.

```bash
pnpm add @ethivia/vacp-sdk zod
```

```ts
import type { VacpNode } from '@ethivia/vacp-sdk';

const dataset = 'vacp://dashboard/dataset';
const chart = 'vacp://dashboard/chart';

const nodes = (loaded: boolean): VacpNode[] => [
  {
    ref: dataset,
    kind: 'DataHandle',
    layer: 'DataLayer',
    availability: loaded ? undefined : { unavailable: 'Select a dataset' },
  },
  { ref: chart, kind: 'Visualization', layer: 'VisualizationLayer', availability: { requires: [dataset] } },
];
```

Return `nodes(loaded)` from your provider's `project()`, as [Custom provider](../custom-provider/) shows. Until `loaded` is true, `observe()` lists neither node.

## Declare prerequisites

The `availability` field of a node or an action takes two keys:

- `requires` lists the refs of nodes that must all be available, in any source.
- `unavailable` is a short reason from your app. Rejected calls and inspection return it.

An entry without `availability` is available. A missing prerequisite ref or a cycle fails the read with an error. Edges and an action's `affects` hide nothing, so an action can load a dataset whose node is still unavailable.

Actions declare prerequisites with `.requires(ref)`. `selectCategory` is your app's function:

```ts
import { createVacpActions } from '@ethivia/vacp-sdk';
import { z } from 'zod';

const actions = createVacpActions();
actions
  .operation('mutation', 'chart.select', 'Select a bar')
  .requires('vacp://dashboard/chart')
  .params(z.object({ category: z.string() }))
  .handle(({ category }) => selectCategory(category));
```

To block an action on a condition such as an empty selection, publish a node with an `unavailable` reason and `.requires()` that node. The [React dashboard](https://examples.vacp.dev/react-dashboard/) does this for its active brush.

## Read the catalog

`observe()`, `getCapabilities()`, and `getState()` return the available nodes, actions, and state. `inspect()` returns the complete catalog with every `availability` declaration, for inspection surfaces and restoration.

## Handle a rejected call

The runtime checks availability before it prepares a call and again right before the change. A call that fails changes nothing, and `error.details` says why:

```json
{
  "code": "action-unavailable",
  "action": "chart.select",
  "status": { "available": false, "blockedBy": ["vacp://dashboard/chart"] }
}
```

`code` is `unknown-action`, `action-unavailable`, or `input-unavailable`. `blockedBy` lists the action's unmet prerequisites, and `reason` holds its own `unavailable` reason if it has one. `input-unavailable` also names the `ref` of an input declared with `role: 'input'` in `operation.refParameters`.

## Explain a blocked action

`createInspectionIndex` follows a blocked action back to its cause. `runtime` comes from `const { runtime } = installVacpRuntime(...)`:

```ts
import { createInspectionIndex } from '@ethivia/vacp-sdk/inspector';

const index = createInspectionIndex(await runtime.inspect());

index.action('chart.select')?.availability; // { available: false, blockedBy: ['vacp://dashboard/chart'] }
index.entity('vacp://dashboard/chart')?.availability; // { available: false, blockedBy: ['vacp://dashboard/dataset'] }
index.entity('vacp://dashboard/dataset')?.availability; // { available: false, blockedBy: [], reason: 'Select a dataset' }
```

[Inspector](../inspector/) builds a view on the index. Python providers declare `Availability(requires=(ref,), unavailable=reason)` under the same rules.
