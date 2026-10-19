# @ethivia/vacp-vega-lite

Provider for [Vega-Lite](https://vega.github.io/vega-lite/) charts rendered as Vega views. The [Vega-Lite guide](../vega-lite/) explains selections, temporal axes, and data handles.

## createVegaLiteProvider

```ts
createVegaLiteProvider(options: {
  view: View;
  spec: VegaLiteSpecLike;
  vgSpec: VegaSpec;
  root?: HTMLElement;
  data?: {
    duckdb: VacpDuckDbClient | Promise<VacpDuckDbClient>;
    sql?: boolean;
    describe?: VacpDataHandleDescriber;
  };
  options: { appId: string; viewId: string; vizId: string; title?: string; description?: string };
}): VacpProvider
```

| Option                                             | Default | Meaning                                                                    |
| -------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `view`                                             |         | The rendered Vega `View`                                                   |
| `spec`                                             |         | The Vega-Lite specification the chart was compiled from                    |
| `vgSpec`                                           |         | The compiled Vega specification, such as vega-embed's `vgSpec`             |
| `root`                                             |         | The chart element, for tooltips and presence targets                       |
| `data.duckdb`                                      |         | A DuckDB client that loads the chart's datasets. The application owns it   |
| `data.sql`                                         | `true`  | Register `vacp.data_sql`. `false` keeps the handles and `vacp.data_schema` |
| `data.describe`                                    |         | States row counts, `metadata`, and `stats` for each handle                 |
| `options.appId`, `options.viewId`, `options.vizId` |         | The root of every ref: `vacp://<appId>/<viewId>/<vizId>`                   |

Refs below the root name parameters as `param/<name>`, marks as `mark/<path>`, their encoding channels and fields, and data handles. The provider leaves the view running when it is disposed.

## Operations

| Contract                    | Parameters                                | Registered when                   |
| --------------------------- | ----------------------------------------- | --------------------------------- |
| `vega_lite.set_param`       | `ref` of a `Param` node, `value`          | The spec has a variable parameter |
| `vega_lite.set_selection`   | `ref` of a `Selection` node, `value`      | The spec has a selection          |
| `vega_lite.clear_selection` | `ref`                                     | The spec has a selection          |
| `vega_lite.hover_tooltip`   | `fields`, `value`, `markName?`, `clear?`  | The chart shows tooltips          |
| `vacp.apply_state`          | `state`                                   | Always                            |
| `vacp.data_sql`             | `handleRef`, `sql`, `format?`, `maxRows?` | `data` with `sql` not `false`     |
| `vacp.data_schema`          | `handleRef`, `detail?`, `sampleRows?`     | `data`                            |

`set_selection` takes `{ channel or field: [min, max] }` for an interval and `{ field: value }` for a point. See [Selections](../vega-lite/#selections) for the rules on omitted channels and dates. `hover_tooltip` matches marks whose data equal `fields`, shows their tooltip, and reports how many marks matched. With no match, its result lists the named marks and the fields they carry. `clear: true` hides the tooltip.

## State

A `Selection` entry holds `{ kind: 'Selection', name, select, value, tuples }`. `value` is the resolved selection, and `tuples` is the native store, which keeps field correlations and unit identity. A `Param` entry holds the parameter's value. A `DataHandle` entry holds `rowCount`, `selectionWhere`, `stats`, and `selectionError` when a selection has no SQL translation.

## createVegaLitePresentation

```ts
import { createVegaLitePresentation } from '@ethivia/vacp-vega-lite/presentation';

createVegaLitePresentation({ provider, root }): PresencePresentation
```

Locates marks, brushes, and bound controls on screen for [presence](../presence/), through the view's scales and renderer transforms. Throws when `provider` is not a live Vega-Lite provider.
