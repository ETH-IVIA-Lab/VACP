# Vega-Lite

`createVegaLiteProvider` connects a chart rendered with [vega-embed](https://github.com/vega/vega-embed), the standard renderer for [Vega-Lite](https://vega.github.io/vega-lite/) specs. Agents set the chart's parameters and selections through its live Vega view, so linked marks update as they do for a mouse interaction.

```ts
import embed from 'vega-embed';
import type { TopLevelSpec } from 'vega-lite';
import { installVacpRuntime, vacpHumanActor } from '@ethivia/vacp-sdk';
import { createVegaLiteProvider } from '@ethivia/vacp-vega';

export async function mountChart(root: HTMLElement, spec: TopLevelSpec) {
  const { view, vgSpec, finalize } = await embed(root, spec, { actions: false });
  const provider = createVegaLiteProvider({
    root,
    view,
    spec,
    vgSpec,
    appId: 'sales',
    viewId: 'overview',
    vizId: 'revenue',
    title: 'Revenue by region',
  });
  const { runtime, dispose } = installVacpRuntime({
    providers: [provider],
    exposeBridge: true,
  });
  void runtime.record({ message: 'Initial chart' });

  const onPointerUp = () => void runtime.record({ actor: vacpHumanActor, message: 'Brushed the revenue chart' });
  root.addEventListener('pointerup', onPointerUp);

  return {
    runtime,
    provider,
    dispose() {
      root.removeEventListener('pointerup', onPointerUp);
      dispose();
      finalize();
    },
  };
}
```

- The refs start at `vacp://<appId>/<viewId>/<vizId>`. The `brush` selection of this chart is `vacp://sales/overview/revenue/param/brush`. Keep the three IDs stable, and give each chart its own `vizId`.
- When the page already has a runtime, add this provider to the existing `providers` array. One `installVacpRuntime` call serves every source.
- Create the provider after `embed` resolves. Pass the same `spec` object you embedded.
- `dispose()` releases the provider's listeners and leaves the view running, so call `finalize()` yourself.
- Add a selection or a variable to the spec's `params` to give an agent something to change.

## Actions

Each action name carries a source prefix, so look it up by contract:

| Contract                    | Parameters                               | Offered when             |
| --------------------------- | ---------------------------------------- | ------------------------ |
| `vega_lite.set_param`       | `ref`, `value`                           | The spec has a variable  |
| `vega_lite.set_selection`   | `ref`, `value`                           | The spec has a selection |
| `vega_lite.clear_selection` | `ref`                                    | The spec has a selection |
| `vega_lite.hover_tooltip`   | `fields`, `value`, `markName?`, `clear?` | The chart shows tooltips |

```ts
import type { VacpRuntime } from '@ethivia/vacp-sdk';

declare const runtime: VacpRuntime;

const { graph } = await runtime.observe();
const select = graph.actions.find((action) => action.operation.contract === 'vega_lite.set_selection')!;
await runtime.execute(
  { name: select.name, params: { ref: 'vacp://sales/overview/revenue/param/brush', value: { y: [20, 30] } } },
  { narration: 'Keeping accounts between 20 and 30 thousand dollars.' },
);
```

Selections take ranges in data units: `{ field: [min, max] }` for an interval and `{ field: value }` for a point, keyed by the data field or its channel such as `y`. A channel left out of a two-channel brush spans its whole axis. A time axis takes ISO dates. A range outside the axis domain fails before the selection changes.

To verify, check the chart itself. Read `document.querySelector('#chart svg')` for the brush rectangle or the mark count, or compare a screenshot, in addition to `state[ref]`.

## Attribute the person's brushes

The `pointerup` listener in the example records a drag as the person's step. Vega applies the selection during the drag, so the state is current when the pointer lifts. Skip this listener for a chart the person cannot brush.

## Let agents query the chart's data

Pass `data` to give each dataset a handle for SQL. See [data.md](data.md) for the client.

```ts
import embed from 'vega-embed';
import type { TopLevelSpec } from 'vega-lite';
import { createDuckDbWasmClient } from '@ethivia/vacp-duckdb';
import { createVegaLiteProvider } from '@ethivia/vacp-vega';

declare const root: HTMLElement;
declare const spec: TopLevelSpec;

const { view, vgSpec } = await embed(root, spec, { actions: false });
const duckdb = createDuckDbWasmClient();
const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
  data: { duckdb },
  appId: 'sales',
  viewId: 'overview',
  vizId: 'revenue',
});
```

In SQL, `vacp_handle` holds the rows the marks draw, narrowed by the current selections, and `vacp_all` holds every row the chart loaded. After the runtime is disposed, call `(await duckdb).dispose()`.

Replay needs no extra code here, because the provider registers `vacp.apply_state`. Presence is in [presence.md](presence.md).
