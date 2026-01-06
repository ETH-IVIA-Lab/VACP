# @vacp/mosaic

First-class VACP integration for Mosaic/vgplot.

## Intended usage (inside vgplot renderer)

After `Plot.plot(spec)` returns an `svg` (and after vgplot annotates `data-index`),
install VACP like this:

```ts
import { installVacpOnVgplot } from '@vacp/mosaic';

// plot: vgplot Plot instance, svg: SVGElement output
installVacpOnVgplot(plot, svg, {
  appId: 'mosaic',
  viewId: 'spec/crossfilter',
  plotId: 'plot-0',
  title: 'Crossfilter',
});
```

This will:

- annotate the SVG with `data-vacp-*` and `data-interaction-vacp-*`
- embed a canonical VACP graph in SVG `<metadata type="application/vacp+json">`
- install an in-page bridge at `window.__vacp` (configurable)
