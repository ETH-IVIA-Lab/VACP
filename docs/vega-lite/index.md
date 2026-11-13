# Vega-Lite

`@ethivia/vacp-vega` lets an agent set the parameters and selections of a rendered [Vega-Lite](https://vega.github.io/vega-lite/) chart and query its data. The agent changes the chart through its own Vega view, so linked marks update as they do for a mouse interaction.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-vega vega vega-lite vega-embed zod
```

Render the chart with [vega-embed](https://github.com/vega/vega-embed), then create the provider from the embed result:

```ts
import embed from 'vega-embed';
import type { TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '@ethivia/vacp-vega';
import { installVacpRuntime } from '@ethivia/vacp-sdk';

const spec: TopLevelSpec = {
  data: { url: 'https://vega.github.io/vega-datasets/data/cars.json' },
  params: [{ name: 'brush', select: 'interval' }],
  mark: 'point',
  encoding: {
    x: { field: 'Horsepower', type: 'quantitative' },
    y: { field: 'Miles_per_Gallon', type: 'quantitative' },
  },
};
const root = document.querySelector<HTMLElement>('#chart')!;
const { view, vgSpec } = await embed(root, spec);
const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
  appId: 'cars',
  viewId: 'overview',
  vizId: 'scatter',
  title: 'Horsepower and mileage',
});
const { runtime, dispose } = installVacpRuntime({ providers: [provider], exposeBridge: true });
```

- `view` is the live Vega view, and `vgSpec` is the compiled Vega specification. The provider reads datasets and selection signals from `vgSpec`.
- `appId`, `viewId`, and `vizId` form the chart's refs. The chart itself is `vacp://cars/overview/scatter`, and the `brush` selection is `vacp://cars/overview/scatter/param/brush`. Keep the IDs stable across reloads.
- `root` lets the provider place presence targets and tooltips over the chart.

`dispose()` releases the provider's listeners and leaves the view to you.

## Mount it in React

[StrictMode](https://react.dev/reference/react/StrictMode) runs each effect twice in development, so the first run must release what it created, even when `embed` resolves after the cleanup:

```tsx
useEffect(() => {
  let released = false;
  let release: (() => void) | undefined;
  void mountChart(element.current!).then((mounted) => {
    if (released) mounted.dispose();
    else release = mounted.dispose;
  });
  return () => {
    released = true;
    release?.();
  };
}, []);
```

`mountChart` is your function that runs the code above and returns `{ dispose }`, where `dispose` calls the `dispose` from `installVacpRuntime` and vega-embed's `finalize`. Keep `spec` stable across renders.

## Set parameters and selections

The provider offers `vega_lite.hover_tooltip`, `vega_lite.set_param` when the spec has plain parameters, and `vega_lite.set_selection` and `vega_lite.clear_selection` when it has selections. The provider prefixes its action names with a hash of the source ID, so find an action by its [contract](../concepts/#action), then call its `name`:

```ts
const { graph } = await runtime.observe();
const select = graph.actions.find((action) => action.operation.contract === 'vega_lite.set_selection')!;
await runtime.execute(
  { name: select.name, params: { ref: 'vacp://cars/overview/scatter/param/brush', value: { y: [20, 30] } } },
  { narration: 'Keeping cars that get 20 to 30 miles per gallon.' },
);
```

Selections take ranges in data units. A channel you leave out of a two-channel brush spans its whole axis, so `{ y: [20, 30] }` acts like a full-width drag. A time axis takes ISO dates such as `"2012-06-01"`. A range outside the axis domain fails before the selection changes. The [Vega-Lite reference](../api/vega) lists each action's parameters.

## Query chart data with SQL

Pass `data` to give each of the chart's datasets a data handle that agents query with SQL. The DuckDB-Wasm client comes from `@ethivia/vacp-duckdb`. [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) runs the DuckDB SQL database in the browser.

```bash
pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0
```

```ts
import { createDuckDbWasmClient } from '@ethivia/vacp-duckdb';

const duckdb = createDuckDbWasmClient();
const provider = createVegaLiteProvider({
  root,
  view,
  spec,
  vgSpec,
  data: { duckdb },
  appId: 'cars',
  viewId: 'overview',
  vizId: 'scatter',
});
```

The provider registers `vacp.data_sql` and `vacp.data_schema` with the handlers from `@ethivia/vacp-sdk/data`. In SQL, `vacp_handle` holds the rows the marks draw, narrowed by the current selections, and `vacp_all` holds every row the chart loaded.

The client starts DuckDB-Wasm on the first query. Without `bundles`, it downloads the engine from the [jsDelivr](https://www.jsdelivr.com) CDN, so the page's [content security policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) must allow that origin. Pass `createDuckDbWasmClient({ bundles })` to serve the engine files yourself. After you dispose the runtime, call `(await duckdb).dispose()`. The [DuckDB reference](../api/duckdb) covers the client options.

## Show presence on the chart

`createVegaLitePresentation` from `@ethivia/vacp-vega` creates the chart's [presentation](../concepts/#presence), which tells [presence](../presence/) where the chart's marks and brushes are on screen:

```ts
import { createVegaLitePresentation } from '@ethivia/vacp-vega';
import { createPresenceOverlay } from '@ethivia/vacp-overlay';

const presence = createPresenceOverlay(runtime);
presence.attach(provider, createVegaLitePresentation(provider));
```

## Restore recorded state

The provider registers `vacp.apply_state`, so [provenance replay](../provenance/) restores the chart's parameters and selections with no code from you.

Try the [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/). Next, [compose the chart with other sources](../composition/).
