# @vacp/vgplot

## Purpose

First-class VACP integration for vgplot (VGPlot runtime).

This provider maps vgplot’s runtime semantics (*View*s, interactors, *Selection*s) into VACP capabilities/state/actions.

## When to use

- You build visualizations with vgplot runtime and want them to be agent-ready.
- You want semantic actions for selection/interaction instead of pixel automation.

## Conceptual model

Treat this provider as a compiler layer:

- vgplot runtime entities become stable refs and graph nodes,
- vgplot interaction semantics become state snapshot entries,
- semantic actions are registered for intent-level operations.

## Minimal usage

Install VACP after rendering:

```ts
import { installVacpOnVgplot } from '@vacp/vgplot';

installVacpOnVgplot(plot, svg, {
  appId: 'vacp-examples',
  viewId: 'vgplot/crossfilter',
  plotId: 'plot-0',
  title: 'Crossfilter (Flights)',
});
```

Runnable example:

- `packages/examples/vgplot-gallery`

## Related docs

- [Providers](../../../../docs/providers/index.md)
- [Examples](../../../../docs/examples/index.md)
- [Tool Contract](../../../../docs/reference/tool-contract.md)
