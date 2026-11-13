# @ethivia/vacp-vgplot

Lets an agent read and change the plots, interactors, legends, inputs, and tables of a [Mosaic](https://idl.uw.edu/mosaic/) vgplot dashboard. Mosaic links views through shared selections that filter database queries, and vgplot is its plotting grammar. The [Mosaic vgplot guide](../vgplot/) shows a complete setup.

```bash
pnpm add @ethivia/vacp-vgplot @uwdata/vgplot @uwdata/mosaic-core @uwdata/mosaic-inputs @uwdata/mosaic-plot @uwdata/mosaic-sql
```

`@ethivia/vacp-sdk` is also a peer dependency. [Install](../install/) adds it.

## createVgplotProvider

```ts
createVgplotProvider(options: VgplotProviderOptions): VacpProvider
```

Creates a provider for one dashboard. `VgplotProviderOptions` holds these fields:

- `plots` is an array of `{ plotId, plot }` with stable IDs. Each plot's interactors and legends become nodes.
- `tables` is an array of `{ tableId, table }` with stable IDs. Defaults to `[]`.
- `root` is the dashboard's `Element`. The provider discovers menu, search, and slider inputs in it, and [presentation](#createvgplotpresentation) reads it.
- `data.duckdb` is a `VacpDuckDbQueryClient`, or a promise of one, on the database Mosaic reads. See [`@ethivia/vacp-sdk/data`](./data).
- `data.sql` registers `vacp.data_sql`. Defaults to `true`. `false` keeps the data handles and `vacp.data_schema`.
- `data.describe` is a `VacpDataHandleDescriber` that states row counts, `metadata`, and `stats` for each handle.
- `appId` and `viewId` name the dashboard and form the root of every ref. Optional `title` and `description` label it.

The source ID is `vacp-source://<appId>/<viewId>/vgplot`.

The dashboard and the provider must share one copy of each Mosaic package. Provider creation throws, naming the package, when it meets an interactor, legend, or input from a second copy whose class names are readable. A minified second copy goes unrecognized.

## Actions

Every action targets an entity by `ref`, and values are in data units. Interval actions take numbers, or dates as ISO text or epoch milliseconds on a temporal scale. Pan and zoom domains take numbers, with epoch milliseconds on a temporal scale.

| Contract                        | Parameters                                       | Registered when the dashboard has                |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `vgplot.set_interval_1d`        | `ref`, `min`, `max`                              | An `intervalX` or `intervalY` interactor         |
| `vgplot.clear_interval_1d`      | `ref`                                            | The same                                         |
| `vgplot.set_interval_2d`        | `ref`, `x0`, `x1`, `y0`, `y1`                    | An `intervalXY` interactor                       |
| `vgplot.clear_interval_2d`      | `ref`                                            | The same                                         |
| `vgplot.set_toggle`             | `ref`, `value`: points as arrays of field values | A `toggle` interactor                            |
| `vgplot.clear_toggle`           | `ref`                                            | The same                                         |
| `vgplot.set_region`             | `ref`, `value`                                   | A `region` interactor                            |
| `vgplot.clear_region`           | `ref`                                            | The same                                         |
| `vgplot.clear_nearest`          | `ref`                                            | A selection-backed `nearest` interactor          |
| `vgplot.set_pan_zoom`           | `ref`, `x0?`, `x1?`, `y0?`, `y1?`                | A `panZoom` interactor                           |
| `vgplot.clear_pan_zoom`         | `ref`                                            | The same                                         |
| `vgplot.set_legend_toggle`      | `ref`, `value`                                   | A categorical legend with a toggle selection     |
| `vgplot.clear_legend_toggle`    | `ref`                                            | The same                                         |
| `vgplot.set_input_value`        | `ref`, `value`                                   | A menu, search, or slider input                  |
| `vgplot.set_input_option_index` | `ref`, `index`                                   | A menu with options                              |
| `vgplot.clear_input`            | `ref`                                            | An input                                         |
| `vgplot.table_set_sort`         | `ref`, `column`, `desc?`                         | A table                                          |
| `vgplot.table_clear_sort`       | `ref`                                            | A table                                          |
| `vgplot.table_set_page`         | `ref`, `offset?`, `limit?`                       | A table                                          |
| `vacp.widget_options`           | `ref`, `offset?`, `limit?`, `query?`             | An input                                         |
| `vacp.apply_state`              | `state`                                          | Always                                           |
| `vacp.data_sql`                 | `handleRef`, `sql`, `format?`, `maxRows?`        | `data` with `sql` not `false`, and a data handle |
| `vacp.data_schema`              | `handleRef`, `detail?`, `sampleRows?`            | `data`, and a data handle                        |

A call fails during preparation, before anything changes, when its ref names no entity of the action's kind or when a value falls outside what the interactor accepts.

- Interval endpoints can come in either order.
- `vgplot.set_pan_zoom` needs both ends of at least one axis. An axis you leave out keeps its domain.
- `vacp.widget_options` lists a menu's options, and an empty list for other inputs. `limit` defaults to 200.
- A slider applies its own bounds and step, and `vgplot.set_input_value` returns the value the slider holds, so a request for 12.5 on a step-1 slider returns 13.

## State

| Node kind    | State                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Interactor   | `selectionValue`: the interactor's own clause value, or `null` when inactive                       |
| Legend       | `selectionValue`: the selected categories                                                          |
| Input        | `selectionValue`: the input's current value                                                        |
| Table        | `sortColumn`, `sortDesc`, `offset`, and `limit`                                                    |
| `Selection`  | Each shared Mosaic selection once, with `activeSource`: the active interactor's ref, or `null`     |
| `DataHandle` | `rowCount`, `selectionWhere`, `stats`, or `selectionError` when a selection has no SQL translation |

State values are complete JSON, and restoration reads them back unchanged. A value that cannot be captured as JSON, such as `NaN` or a cycle, replaces its own entry with `{ kind, readError }`.

## createVgplotPresentation

```ts
createVgplotPresentation(provider): PresencePresentation
```

Locates interactors, brushes, legend entries, inputs, and table headers on screen for [presence](../presence/).

- `provider` is a provider from `createVgplotProvider`. Presence reads its `root`.

Throws when `provider` is not a live vgplot provider or was created without a `root`.
