# @vacp/adapter-vgplot

Provider for [Mosaic](https://idl.uw.edu/mosaic/) vgplot plots, interactors, legends, inputs, and tables. The [Mosaic vgplot guide](../vgplot/) explains crossfilters, restoration, and data handles.

## createVgplotProvider

```ts
createVgplotProvider(options: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
  root?: ParentNode;
  data?: {
    duckdb: VacpDuckDbQueryClient | Promise<VacpDuckDbQueryClient>;
    sql?: boolean;
    describe?: VacpDataHandleDescriber;
  };
  options: { appId: string; viewId: string; title?: string; description?: string };
}): VacpProvider
```

| Option                            | Default | Meaning                                                                            |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `plots`                           |         | Plots with stable IDs. Each plot's interactors and legends become nodes            |
| `tables`                          | `[]`    | Mosaic tables with stable IDs                                                      |
| `root`                            |         | The dashboard element. The adapter discovers menu, search, and slider inputs in it |
| `data.duckdb`                     |         | A query client on the database Mosaic reads                                        |
| `data.sql`                        | `true`  | Register `vacp.data_sql`. `false` keeps the handles and `vacp.data_schema`         |
| `data.describe`                   |         | States row counts, `metadata`, and `stats` for each handle                         |
| `options.appId`, `options.viewId` |         | The root of every ref the provider creates                                         |

Throws when an interactor, legend, or input comes from a second copy of a Mosaic package, naming the package. The source ID is `vacp-source://<appId>/<viewId>/vgplot`.

## Operations

Every operation targets an entity by `ref`. Interval and domain values are in data units: numbers, or dates as ISO text or epoch milliseconds on a temporal scale.

| Contract                        | Parameters                                       | Registered when the dashboard has            |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `vgplot.set_interval_1d`        | `ref`, `min`, `max`                              | An `intervalX` or `intervalY` interactor     |
| `vgplot.clear_interval_1d`      | `ref`                                            | The same                                     |
| `vgplot.set_interval_2d`        | `ref`, `x0`, `x1`, `y0`, `y1`                    | An `intervalXY` interactor                   |
| `vgplot.clear_interval_2d`      | `ref`                                            | The same                                     |
| `vgplot.set_toggle`             | `ref`, `value`: points as arrays of field values | A `toggle` interactor                        |
| `vgplot.clear_toggle`           | `ref`                                            | The same                                     |
| `vgplot.set_region`             | `ref`, `value`                                   | A `region` interactor                        |
| `vgplot.clear_region`           | `ref`                                            | The same                                     |
| `vgplot.clear_nearest`          | `ref`                                            | A selection-backed `nearest` interactor      |
| `vgplot.set_pan_zoom`           | `ref`, `x0`, `x1`, `y0`, `y1`                    | A `panZoom` interactor                       |
| `vgplot.clear_pan_zoom`         | `ref`                                            | The same                                     |
| `vgplot.set_legend_toggle`      | `ref`, `value`                                   | A categorical legend with a toggle selection |
| `vgplot.clear_legend_toggle`    | `ref`                                            | The same                                     |
| `vgplot.set_input_value`        | `ref`, `value`                                   | A menu, search, or slider input              |
| `vgplot.set_input_option_index` | `ref`, `index`                                   | A menu whose options are not plain strings   |
| `vgplot.clear_input`            | `ref`                                            | An input                                     |
| `vgplot.table_set_sort`         | `ref`, `column`, `desc?`                         | A table                                      |
| `vgplot.table_clear_sort`       | `ref`                                            | A table                                      |
| `vgplot.table_set_page`         | `ref`, `offset?`, `limit?`                       | A table                                      |
| `vacp.widget_options`           | `ref`, `offset?`, `limit?`, `query?`             | A menu input                                 |
| `vacp.apply_state`              | `state`                                          | Always                                       |
| `vacp.data_sql`                 | `handleRef`, `sql`, `format?`, `maxRows?`        | `data` with `sql` not `false`                |
| `vacp.data_schema`              | `handleRef`, `detail?`, `sampleRows?`            | `data`                                       |

A call fails during preparation, before anything changes, when its ref names no entity of the operation's kind or a value falls outside what the interactor accepts. Interval endpoints may come in either order. `set_input_option_index` and `vacp.widget_options` apply to menus. A slider applies its own bounds and step, and `set_input_value` returns the value the slider holds, so a request for 12.5 on a step-1 slider returns 13.

## State

| Node kind    | State                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Interactor   | `selectionValue`: the interactor's own clause value, or `null` when inactive                        |
| Legend       | `selectionValue`: the selected categories                                                           |
| Input        | `selectionValue`: the input's current value                                                         |
| Table        | Sort column, direction, offset, and limit                                                           |
| `Selection`  | Each shared Mosaic selection once, with `activeSource`: the active interactor's ref, or `null`      |
| `DataHandle` | `rowCount`, `selectionWhere`, `stats`, and `selectionError` when a selection has no SQL translation |

State values are complete JSON, and restoration reads them back unchanged. A value that cannot be captured as JSON, such as `NaN` or a cycle, replaces only its own entry with `{ kind, readError }`.

## createVgplotPresentation

```ts
import { createVgplotPresentation } from '@vacp/adapter-vgplot/presentation';

createVgplotPresentation({ provider, root }): PresencePresentation
```

Locates interactors, brushes, legend entries, inputs, and table headers on screen for [presence](../presence/). Throws when `provider` is not a live vgplot provider.
