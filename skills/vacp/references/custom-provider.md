# Custom provider

Use `createVacpProvider` when the source is an app store, a form, or a chart library VACP has no provider for. This example connects a filter store with two values.

```ts
import {
  VacpActionError,
  createVacpActions,
  createVacpProvider,
  createVacpRefBuilder,
  registerVacpApplyStateAction,
} from '@ethivia/vacp-sdk';
import { z } from 'zod';

type Filters = { region: string; minRevenue: number };
type FilterStore = {
  read(): Filters;
  write(next: Partial<Filters>): void;
  subscribe(listener: () => void): () => void;
};

const regions = ['amer', 'emea', 'apac'] as const;
const regionValue = z.enum(regions);
const minRevenueValue = z.number().finite().min(0);

export function createFiltersProvider(store: FilterStore, maxRevenue: () => number) {
  const refs = createVacpRefBuilder({ appId: 'sales', viewId: 'filters' });
  const region = refs.ref('region');
  const minRevenue = refs.ref('min-revenue');
  const actions = createVacpActions();

  actions
    .operation('mutation', 'filters.set_region', 'Show one sales region')
    .affects(region)
    .params(z.object({ region: regionValue }))
    .focus(() => ({ ref: region, interaction: { kind: 'activate' } }))
    .handle((params) => {
      store.write(params);
      return { region: store.read().region };
    });

  actions
    .operation('mutation', 'filters.set_min_revenue', 'Hide accounts below this revenue, in thousands of dollars')
    .affects(minRevenue)
    .params(z.object({ minRevenue: minRevenueValue }))
    .focus(() => ({ ref: minRevenue, interaction: { kind: 'drag', axis: 'x' } }))
    .handle((params) => {
      if (params.minRevenue > maxRevenue()) {
        throw new VacpActionError('The minimum exceeds every account', { max: maxRevenue() });
      }
      store.write(params);
      return { minRevenue: store.read().minRevenue };
    });

  registerVacpApplyStateAction(
    actions,
    (state) => {
      const next = {
        region: regionValue.parse(state[region]),
        minRevenue: minRevenueValue.parse(state[minRevenue]),
      };
      return () => {
        store.write(next);
        return { applied: [region, minRevenue] };
      };
    },
    { affects: [region, minRevenue] },
  );

  return createVacpProvider({
    source: { id: 'vacp-source://sales/filters', type: 'control', title: 'Filters' },
    actions,
    project: () => {
      const current = store.read();
      return {
        graph: {
          nodes: [
            { ref: region, kind: 'Param', layer: 'ConfigLayer', title: 'Region', data: { options: regions } },
            { ref: minRevenue, kind: 'Param', layer: 'ConfigLayer', title: 'Minimum revenue' },
          ],
        },
        state: { [region]: current.region, [minRevenue]: current.minRevenue },
      };
    },
    subscribe: (invalidate) => store.subscribe(invalidate),
  });
}
```

This store changes without a person, so `subscribe` reports it. When a person drives the change, call `runtime.record({ actor: vacpHumanActor })` from the control and leave `subscribe` out. Reporting one change through both records it twice.

Pass the provider to `installVacpRuntime`, as [SKILL.md](../SKILL.md) shows.

## Model the source

- `kind` names what a node is. Use `Param` for a value, `Selection` for a brush or a picked set, `Visualization` for a chart, `Widget` for a control, `DataHandle` for queryable rows, or your own string.
- `layer` groups nodes: `ConfigLayer`, `ViewLayer`, `VisualizationLayer`, `DataLayer`, `InteractionFeedbackLayer`, or your own string.
- `state` maps each ref to its current value, in the shape the action that sets it accepts, so `vacp.apply_state` can hand it back. Every key needs a node in the graph, or `observe()` fails.
- `edges` link nodes. Declare `controls`, `derivedFrom`, or `targets` when the app knows that one entity changes or feeds another. An edge may point at a node in another source, and both ends must exist.

## Define actions

`.operation(kind, name, description)` starts an action. `kind` is `mutation`, `creation`, `evaluation`, or `query`. Chain these before `.params()`:

- `.affects(...refs)` for the entities the action changes.
- `.input(...refs)` for the entities it reads.
- `.requires(...refs)` for nodes that must be available before the action is offered.
- `.contract(name)` for a shared meaning across differently named actions.

`.focus((params) => ({ ref, interaction }))` tells presence where the step happens. `interaction.kind` is `point`, `activate`, `brush`, `drag`, `pan`, `zoom`, `edit`, or `resize`.

Name the action for its effect in the domain, such as `filters.set_region`. Write the description for an agent that sees only this text.

## Restore recorded state

`registerVacpApplyStateAction` lets replay restore a checkpoint. Its callback receives the desired state, validates it, and returns a function that applies it. A throw rejects the state before anything changes. Agents can call `vacp.apply_state` too, so parse with the same schemas your actions use.

Replay works only for sources that register this action. Skip it when the task needs no replay.

## Declare availability

Set `availability` on a node when it cannot be used yet:

```ts
import type { VacpNode } from '@ethivia/vacp-sdk';

declare const loaded: boolean;

const chart = {
  ref: 'vacp://sales/overview/chart',
  kind: 'Visualization',
  layer: 'VisualizationLayer',
  availability: loaded ? undefined : { unavailable: 'Select a dataset' },
} satisfies VacpNode;
```

Agents see only what is available. Use `availability: { requires: [ref] }` and `.requires(ref)` for prerequisites on other nodes, and call `invalidate` when the condition changes.

## Compose several sources

Pass every provider to one call: `installVacpRuntime({ providers: [filters, chart], exposeBridge: true })`. A later call with the same `globalKey` adds providers to the same runtime, and a provider with an existing source ID replaces that source.

Action names must be unique across the composed graph. Pass the source ID to `createVacpActions(sourceId)` when two sources could register the same name, and keep the source ID in one constant. The names then read `source_<hash>.<name>`, so agents and tests find an action by `.contract(name)` or from its `affects` refs.

Full guide: <https://docs.vacp.dev/composition/>.
