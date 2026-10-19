# Declare availability

A provider publishes its complete catalog of nodes and operations. Each one can state when it is usable, and VACP discloses only what is usable now. An agent reading the React dashboard before a dataset loads sees the dataset picker and no brushing operation.

```ts
import type { VacpNode } from '@ethivia/vacp-protocol';

const dataset = {
  ref: 'vacp://dashboard/dataset',
  kind: 'DataHandle',
  layer: 'DataLayer',
  availability: loaded ? undefined : { unavailable: 'Select a dataset' },
} satisfies VacpNode;

const chart = {
  ref: 'vacp://dashboard/chart',
  kind: 'Visualization',
  layer: 'VisualizationLayer',
  availability: { requires: ['vacp://dashboard/dataset'] },
} satisfies VacpNode;
```

## Declare prerequisites

- `requires` lists nodes that must all be available. Prerequisites may live in another source.
- `unavailable` is a short reason from the host, shown to agents and people.
- A node or operation without `availability` is available.
- A missing prerequisite ref or a cycle is an error, even behind an unavailable node.
- Relationships do not imply prerequisites. `inputRefs`, `affects`, `results`, and `contains` edges hide nothing. An operation that loads a dataset can affect the unavailable dataset node and stay available itself.

State prerequisites as facts about the current entities, so a person selecting a dataset and an agent selecting it enable the same operations. For a condition that is not a node, evaluate it in the host and publish `unavailable` with a reason.

Operations declare prerequisites through `.requires(ref)` in `@ethivia/vacp-sdk`:

```ts
actions
  .operation('mutation', 'chart.select', 'Select a bar')
  .requires('vacp://dashboard/chart')
  .params(z.object({ category: z.string() }))
  .handle(({ category }) => selectCategory(category));
```

An operation whose usability depends on its own state gets its reason in the projection, next to the state it depends on:

```ts
project: () => ({
  graph: {
    nodes,
    edges,
    actions: actions.registry.list().map((action) =>
      action.name === clear.name && !model.selection.length
        ? { ...action, availability: { ...action.availability, unavailable: 'No selection to clear' } }
        : action,
    ),
  },
  state: { [selectionRef]: model.selection },
}),
```

## What reads disclose

| Call                                           | Returns                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `observe()`, `getCapabilities()`, `getState()` | The available nodes, operations, and state. Edges and ownership follow the disclosed nodes. |
| `inspect()`                                    | The complete catalog and state, with every `availability` declaration                       |

A state delta reports a ref that became unavailable as removed. `inspect()` serves inspection surfaces and restoration, and executes nothing.

Execution checks availability before preparation, and again after preparation and any presentation pause, right before the change. A call to an operation that became unavailable in between fails without changing anything. A ref parameter declared in `operation.refParameters` with `role: 'input'` must name an available node.

A rejected call carries `error.details`:

```json
{
  "code": "action-unavailable",
  "action": "chart.select",
  "status": { "available": false, "blockedBy": ["vacp://dashboard/chart"] }
}
```

`blockedBy` lists the unmet prerequisites the operation declares itself, and `reason` appears when the operation has its own `unavailable` reason. The chart's status in turn names the dataset and its reason, `"Select a dataset"`, which [inspection](#explain-a-blocked-operation) reads.

`code` is `unknown-action`, `action-unavailable`, or `input-unavailable`. An `input-unavailable` error also names the `ref` of the unavailable input.

## Explain a blocked operation

`createInspectionIndex` from `@ethivia/vacp-inspector-core` reads the complete catalog. `entity(ref).availability`, `entity(ref).prerequisites`, `entity(ref).dependents`, and `action(name).availability` explain why a node or an operation is blocked, and `availableActions` lists what runs now. See [Inspection surfaces](../inspector/).

Python providers declare `Availability(requires=(ref,), unavailable=reason)` on nodes and operations, with the same rules, checked against fixtures shared with the TypeScript protocol.
