# VGPlot

`@vacp/adapter-vgplot` exposes Mosaic VGPlot marks, selections, interactors, input widgets, and tables through VACP.

For an existing `plot` and its rendered `svg` element:

```ts
import { installVacpOnVgplot } from '@vacp/adapter-vgplot';

installVacpOnVgplot(plot, svg, {
  appId: 'analysis',
  viewId: 'overview',
  plotId: 'scatter',
});
```

For a dashboard, use `installVacpOnVgplotDashboard({ root, plots, tables, options })`. Each plot supplies a `plotId`, the VGPlot object, its element, and an optional SVG element. Each table supplies a `tableId`, the table object, and its element.

The provider maps brushing, toggles, nearest-point selection, pan and zoom, menus, and table interactions to semantic actions. Actions update the existing Mosaic selections so linked views respond through their usual dataflow.

Pass `options.duckdbClient` to expose data queries through the dashboard's database connection.

Try the [VGPlot gallery](https://examples.vacp.dev/vgplot/).
