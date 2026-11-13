# @ethivia/vacp-vega

Lets an agent read and change [Vega-Lite](https://vega.github.io/vega-lite/) charts rendered as Vega views. Vega-Lite is a JSON grammar for charts that compiles to Vega. The [Vega-Lite guide](../vega-lite/) shows a complete setup.

```bash
pnpm add @ethivia/vacp-vega vega vega-lite
```

`@ethivia/vacp-sdk` is also a peer dependency. [Install](../install/) adds it.

## createVegaLiteProvider

```ts
createVegaLiteProvider(options: VegaLiteProviderOptions): VacpProvider
```

Creates a provider for one rendered chart. Disposing the provider leaves the view running. `VegaLiteProviderOptions` holds these fields:

- `view` is the rendered Vega `View`.
- `spec` is the `VegaLiteSpecLike` the chart was compiled from.
- `vgSpec` is the compiled Vega specification, such as the `vgSpec` that [vega-embed](https://github.com/vega/vega-embed) returns.
- `root` is the chart's `HTMLElement`, for tooltips and [presentation](#createvegalitepresentation).
- `data.duckdb` is a `VacpDuckDbClient`, or a promise of one, that loads the chart's datasets. Your app owns the client. See [`@ethivia/vacp-sdk/data`](./data).
- `data.sql` registers `vacp.data_sql`. Defaults to `true`. `false` keeps the data handles and `vacp.data_schema`.
- `data.describe` is a `VacpDataHandleDescriber` that states row counts, `metadata`, and `stats` for each handle.
- `appId`, `viewId`, and `vizId` name the chart, and optional `title` and `description` label it. `title` defaults to `vizId`.

Every ref starts with `vacp://<appId>/<viewId>/<vizId>`. Below that root, `param/<name>` names a parameter and `mark/<path>` names a mark, with its encoding channels and fields below it. The source ID is `vacp-source://<appId>/<viewId>/<vizId>/vega-lite`.

## Actions

| Contract                    | Parameters                                 | Registered when                                              |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `vega_lite.set_param`       | `ref` of a `Param` node, `value`           | The spec has a variable parameter                            |
| `vega_lite.set_selection`   | `ref` of a `Selection` node, `value`       | The spec has a selection                                     |
| `vega_lite.clear_selection` | `ref`                                      | The spec has a selection                                     |
| `vega_lite.hover_tooltip`   | `fields?`, `value?`, `markName?`, `clear?` | A unit spec sets `encoding.tooltip` or `tooltip` on its mark |
| `vacp.apply_state`          | `state`                                    | Always                                                       |
| `vacp.data_sql`             | `handleRef`, `sql`, `format?`, `maxRows?`  | `data` with `sql` not `false`                                |
| `vacp.data_schema`          | `handleRef`, `detail?`, `sampleRows?`      | `data`                                                       |

`vega_lite.set_selection` takes `{ channel or field: [min, max] }` for an interval and `{ field: value }` for a point. A point selection reads back as `{ field: [value], vlPoint: ... }`. The guide covers [omitted channels and dates](../vega-lite/#set-parameters-and-selections).

`vega_lite.hover_tooltip` matches marks whose data equal `fields`, shows their tooltip, and reports how many marks matched. Until the hover clears, `vacp_handle` holds the rows that match `fields`. With no match, the result lists the named marks and the fields they carry. `clear: true` hides the tooltip.

## State

- A `Selection` entry holds `{ kind: 'Selection', name, select, value, tuples }`. `value` is the resolved selection, and `tuples` is the native store, which keeps field correlations and unit identity.
- A `Param` entry holds `{ kind: 'Param', name, value, bind }`.
- A `DataHandle` entry holds `rowCount`, `selectionWhere`, and `stats`. It holds `selectionError` in place of `selectionWhere` when a selection has no SQL translation.

## createVegaLitePresentation

```ts
createVegaLitePresentation(provider): PresencePresentation
```

Locates marks, brushes, and bound controls on screen for [presence](../presence/), through the view's scales and renderer transforms.

- `provider` is a provider from `createVegaLiteProvider`. Presence reads its `root`.

Throws when `provider` is not a live Vega-Lite provider or was created without a `root`.
