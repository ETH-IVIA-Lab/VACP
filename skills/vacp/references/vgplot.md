# Mosaic vgplot

`createVgplotProvider` connects the brushes, legends, inputs, and tables of a [Mosaic](https://idl.uw.edu/mosaic/) vgplot dashboard. Mosaic links views through shared selections that filter database queries, and the provider changes those selections the way Mosaic's own interactors do.

This example shares one [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) database between Mosaic and the agent's SQL, so both read the same tables.

```bash
pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0
```

Mosaic depends on a prerelease of `@duckdb/duckdb-wasm`. Without this override the two copies produce incompatible types and two engine builds. With pnpm, put it in `pnpm-workspace.yaml`, creating the file in a single-package app, and run `pnpm install`. With npm, use `overrides` in `package.json`.

```yaml
overrides:
  '@duckdb/duckdb-wasm': 1.32.0
```

```ts
import { DuckDBWASMConnector, Selection, coordinator } from '@uwdata/mosaic-core';
import * as vg from '@uwdata/vgplot';
import { installVacpRuntime, vacpHumanActor } from '@ethivia/vacp-sdk';
import { countDuckDbTablesOnce } from '@ethivia/vacp-sdk/data';
import { createDuckDbWasmClient, instantiateDuckDbWasm } from '@ethivia/vacp-duckdb';
import { createVgplotProvider, type VgplotPlotLike } from '@ethivia/vacp-vgplot';

export async function mountDashboard(root: HTMLElement, rows: Record<string, unknown>[]) {
  const database = await instantiateDuckDbWasm();
  const connector = new DuckDBWASMConnector({ duckdb: database });
  coordinator().databaseConnector(connector);
  const duckdb = await createDuckDbWasmClient({ duckdb: database, connection: await connector.getConnection() });
  await duckdb.loadObjectsAsTable('trips', rows);

  const brush = Selection.crossfilter();
  const element = vg.plot(
    vg.rectY(vg.from('trips', { filterBy: brush }), { x: vg.bin('hour'), y: vg.count() }),
    vg.intervalX({ as: brush }),
  );
  root.append(element);
  const plot = (element as HTMLElement & { value: VgplotPlotLike }).value;
  await plot.update?.();

  const provider = createVgplotProvider({
    root,
    plots: [{ plotId: 'hours', plot }],
    data: { duckdb, describe: countDuckDbTablesOnce(duckdb) },
    appId: 'taxis',
    viewId: 'overview',
    title: 'Trips by hour',
  });
  const { runtime, dispose } = installVacpRuntime({
    providers: [provider],
    exposeBridge: true,
  });
  void runtime.record({ message: 'Initial dashboard' });

  const onPointerUp = () => void runtime.record({ actor: vacpHumanActor, message: 'Brushed the trips histogram' });
  root.addEventListener('pointerup', onPointerUp);

  return {
    runtime,
    provider,
    async dispose() {
      root.removeEventListener('pointerup', onPointerUp);
      dispose();
      element.remove();
      await duckdb.dispose();
    },
  };
}
```

Remove `data` to give agents no SQL. Then the app needs neither `@ethivia/vacp-duckdb` nor the override, and Mosaic keeps its own connector.

## Mount order and identity

- Create the provider after the plots render. Mosaic attaches interactors and legends during the first render, and the provider finds them when you create it. A provider created earlier reports no brushes.
- vgplot returns each plot's element and keeps the plot object in the element's `value`. Pass each plot with a stable `plotId`. Add `tables: [{ tableId, table }]` for Mosaic tables.
- `root` lets the provider find menu, search, and slider inputs and place presence targets.
- `options.appId` and `options.viewId` form the refs. The plot above is `vacp://taxis/overview/hours`.
- The provider recognizes Mosaic objects by their classes, so the bundle must hold one copy of each `@uwdata/mosaic-*` package at the versions `@uwdata/vgplot` depends on. A second copy fails provider creation with an error that names the package.

## Actions

Each interactor, legend, input, and table is a node in the graph. Look up an action by its contract, and pass the node's ref with values in data units:

```ts
import type { VacpRuntime } from '@ethivia/vacp-sdk';

declare const runtime: VacpRuntime;

const { graph } = await runtime.observe();
const setBrush = graph.actions.find((action) => action.operation.contract === 'vgplot.set_interval_1d')!;
const brushRef = graph.nodes.find((node) => node.kind === 'InteractionTarget')!.ref;
await runtime.execute(
  { name: setBrush.name, params: { ref: brushRef, min: 6, max: 12 } },
  { narration: 'Keeping trips between 6 and 12 in the morning.' },
);
```

| Contract                                                             | Parameters                        |
| -------------------------------------------------------------------- | --------------------------------- |
| `vgplot.set_interval_1d`                                             | `ref`, `min`, `max`               |
| `vgplot.set_interval_2d`                                             | `ref`, `x0`, `x1`, `y0`, `y1`     |
| `vgplot.set_toggle`, `vgplot.set_region`, `vgplot.set_legend_toggle` | `ref`, `value`                    |
| `vgplot.set_pan_zoom`                                                | `ref`, `x0?`, `x1?`, `y0?`, `y1?` |
| `vgplot.set_input_value`                                             | `ref`, `value`                    |
| `vgplot.set_input_option_index`                                      | `ref`, `index`                    |
| `vgplot.table_set_sort`                                              | `ref`, `column`, `desc?`          |
| `vgplot.table_set_page`                                              | `ref`, `offset?`, `limit?`        |
| Every `vgplot.clear_*` contract, and `vgplot.table_clear_sort`       | `ref`                             |

The full list is at <https://docs.vacp.dev/api/vgplot>. To verify, read the bars or rows other views draw after the brush, because a crossfilter leaves the brushed view itself unfiltered. With `data`, compare `SELECT count(*) FROM vacp_handle` before and after.

The `pointerup` listener records a drag as the person's step. Replay needs no extra code here, because the provider registers `vacp.apply_state`. Presence is in [presence.md](presence.md).
