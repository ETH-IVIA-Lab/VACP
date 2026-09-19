# Disclose available capabilities

Agents should see the actions they can use now. An app can describe its full catalog while VACP discloses only the currently available nodes, actions, and state.

A capability can declare node prerequisites and a current reason it is unavailable:

```ts
import type { VacpNode } from '@vacp/protocol';

const dataset = {
  ref: 'vacp://dataset',
  kind: 'DataHandle',
  layer: 'DataLayer',
  availability: { unavailable: loaded ? undefined : 'Select a dataset' },
} satisfies VacpNode;
const chart = {
  ref: 'vacp://chart',
  kind: 'Visualization',
  layer: 'VisualizationLayer',
  availability: { requires: ['vacp://dataset'] },
} satisfies VacpNode;
```

All prerequisites must be available. A capability with no availability declaration is available. Prerequisites may cross provider boundaries; composition resolves them against the complete graph. Missing refs and cycles are errors, even behind an unavailable node.

Declare action prerequisites through descriptors or the SDK:

```ts
import { z } from 'zod';

actions
  .operation('mutation', 'chart.select', 'Select a bar')
  .requires('vacp://chart')
  .affects('vacp://selection')
  .params(
    { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] },
    z.object({ category: z.string() }),
  )
  .handle(({ category }) => selectCategory(category));
```

Use a parser with `.params(schema, parser)` before `.focus()` or `.handle()` when those callbacks need typed parameters. Parameters are defined once; repeated `.requires()` calls add prerequisites. Standard action registration options also accept `availability`.

`requires` describes prerequisites. `inputRefs`, `affects`, and `results` describe analytical relationships. They do not implicitly hide actions. An acquisition action may affect a currently unavailable dataset without requiring it. Likewise, `contains` does not imply availability inheritance: a dataset selector inside an empty chart container can remain usable.

Model prerequisites as facts about current entities, not a history of which actions ran. A person selecting a dataset must enable the same operations as an agent selecting it. For alternative or domain-specific conditions, evaluate them in the host and publish `unavailable` with a short reason. VACP does not interpret expressions or embed a workflow language.

## Read and execute

- `observe()`, `getCapabilities()`, and `getState()` disclose the available surface. State deltas report refs that became unavailable as removed. Edges and ownership follow the disclosed nodes and actions.
- `inspect()` returns the complete catalog and state for inspection. It grants no execution bypass.
- Execution checks current availability before preparation and again after preparation and presentation waits, before invoking the prepared operation. A stale action call fails without mutation. Providers still own parameter validation and must protect native effects after their own asynchronous work.
- Input refs declared through `operation.refParameters` must resolve to currently available nodes when called. A parameterized action's remaining value constraints belong to its schema and provider validation.

Rejected execution returns structured `error.details`: `code` is `unknown-action`, `action-unavailable`, or `input-unavailable`, with the action name and, when applicable, the input `ref` and current `status` (`available`, `blockedBy`, `reason`). Use these fields to explain a blocked operation without parsing error messages. Invalid declarations identify their owner; cycle errors list unresolved nodes.

For lower-level composition, `composeVacpProviders(...).read()` returns `inspection`, disclosed `observation`, and `availability` from one coherent read. The runtime selects the appropriate view for each public read and reuses the resolution when guarding execution.

Publish availability in the same observation as graph and state. The `createVacpProvider` projector owns the complete graph, including its actions. Use the registry catalog directly for static descriptors, or project current action reasons from the same host state:

```ts
const clear = actions
  .operation('mutation', 'selection.clear', 'Clear selected points')
  .requires('vacp://chart')
  .handle(() => model.clearSelection());

const project = () => {
  const selection = model.selection;
  return {
    graph: {
      version: VACP_SCHEMA_VERSION,
      nodes,
      edges,
      actions: [
        {
          ...clear,
          availability: {
            ...clear.availability,
            unavailable: selection.length ? undefined : 'No selection to clear',
          },
        },
      ],
    },
    state: { [selectionRef]: selection },
  };
};
```

An action's current reason belongs to its description; a shared entity prerequisite belongs on the node. Keep the full catalog in the projection and let VACP disclose it.

Change the provider revision whenever graph, state, summary, or freshness changes, and notify subscribers. Omit the revision to let `createVacpProvider` compute it from that complete projection.

The inspector keeps unavailable entities and operations, their reasons, and dependency chains. Use `createInspectionIndex` to read `availableActions`, `entity(ref).availability`, `entity(ref).prerequisites`, `entity(ref).dependents`, and `action(name).availability`.

## Transports and decision models

WebMCP registration follows the current action set. MCP and direct agent tools read the same disclosed observations and execute through the same runtime guard. Refresh discovery after a state change.

A finite-choice model can use the disclosed actions as its candidates, choose one, then choose valid parameters from application-owned options. Include a stop or ask option when no relevant action exists. The host validates and executes the choice, reads the next observation, and repeats. Model confidence is a routing input, not evidence that an unavailable operation is safe. This pattern does not require a particular model service.

Python providers use `Availability(requires=(ref,), unavailable=reason)` on `Node` and `OperationDescriptor`. `ProviderComposer.observe()` discloses the available surface; `inspect()` and the inspection HTTP endpoint retain the complete catalog. Invocation enforces the same prerequisites. Both implementations run shared protocol fixtures.
