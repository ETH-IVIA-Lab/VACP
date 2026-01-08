# @vacp/mosaic

First-class VACP integration for Mosaic/vgplot.

This package is the “provider” layer for Mosaic:

- it builds a VACP graph from vgplot’s semantic runtime (interactors, linked views),
- it exposes selection state through `window.__vacp`,
- it registers semantic actions like `mosaic.set_interval_1d` (so agents don’t drag pixels).

## Use with a single plot

After `Plot.plot(...)` (or vgplot) produces an `SVGElement`, install VACP:

```ts
import { installVacpOnVgplot } from '@vacp/mosaic';

// plot: vgplot Plot-like instance, svg: SVGElement output
installVacpOnVgplot(plot, svg, {
  appId: 'vacp-examples',
  viewId: 'mosaic/crossfilter',
  plotId: 'plot-0', // local id within the view
  title: 'Crossfilter (Flights)',
});
```

## Use with a dashboard

If your view renders multiple `.plot` blocks, install once at the view root:

```ts
import { installVacpOnVgplotDashboard } from '@vacp/mosaic';

installVacpOnVgplotDashboard({
  root: viewRoot,
  plots: [
    // Some Mosaic specs render an SVG plot; others render non-SVG outputs (tables, legends-only).
    // Provide the "surface element" either way, and optionally an SVG if present.
    { plotId: 'plot-0', plot, element: plotHostEl, svg: plotSvgEl },
    { plotId: 'plot-1', plot, element: plotHostEl, svg: plotSvgEl },
  ],
  tables: [
    // Mosaic `input: table` surfaces (sortable / infinite scroll) are modeled as first-class VACP surfaces too.
    { tableId: 'table-0', table, element: tableHostEl },
  ],
  options: { appId: 'vacp-examples', viewId: 'mosaic/crossfilter', title: 'Crossfilter (Flights)' },
});
```

## What it installs

- SVG annotations: `data-vacp-*` + `data-interaction-vacp-*`
- Embedded graph: `<metadata type="application/vacp+json">…</metadata>`
- Stable bridge: installs/updates `window.__vacp` (via `@vacp/gateway`)
- Actions: brush/toggle/input operations mapped to Mosaic interactors

For a runnable reference, see `packages/examples/mosaic-gallery`.
