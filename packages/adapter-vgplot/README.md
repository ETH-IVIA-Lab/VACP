# @vacp/adapter-vgplot

## Purpose

First-class VACP integration for VGPlot.

This provider maps VGPlot runtime semantics (*View*s, interactors, *Selection*s) into VACP capabilities/state/actions.

## When to use

- You build visualizations with the VGPlot runtime and want VACP state and actions.
- You want semantic actions for selection/interaction instead of pixel automation.

## Conceptual model

The provider maps VGPlot concepts into VACP:

- VGPlot runtime entities become stable refs and graph nodes,
- VGPlot interaction semantics become state snapshot entries,
- semantic actions are registered for intent-level operations.

## Minimal usage

Install VACP after rendering:

```ts
import { installVacpOnVgplot } from '@vacp/adapter-vgplot';

installVacpOnVgplot(plot, svg, {
  appId: 'vacp-examples',
  viewId: 'vgplot/crossfilter',
  plotId: 'plot-0',
  title: 'Crossfilter (Flights)',
});
```

Runnable example:

- `examples/vgplot-gallery`

## Related docs

- [Providers](../../docs/providers/index.md)
- [Examples](../../docs/examples/index.md)
- [Tool Contract](../../docs/reference/tool-contract.md)
