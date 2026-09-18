# @vacp/adapter-vega-lite

## Purpose

VACP provider for interactive Vega-Lite/Vega views.

This provider connects to a Vega _View_ and exposes a stable VACP bridge with capabilities, state, and semantic actions.

## When to use

- You render Vega-Lite (or Vega) and want VACP state and actions.
- You want to control *Param*s and *Selection*s through semantic actions.

## Conceptual model

The provider maps the Vega runtime into VACP:

- _View_/_Param_/_Selection_ entities become graph nodes with stable refs,
- _Param_ and _Selection_ values appear in the state snapshot,
- semantic actions set *Param*s and clear *Selection*s.

## Minimal usage

After you have a Vega _View_ (for example from `vega-embed`):

```ts
import { installVacpOnVegaLiteView } from '@vacp/adapter-vega-lite';

installVacpOnVegaLiteView({
  root,
  view,
  spec,
  options: {
    appId: 'vacp-examples',
    viewId: 'vega-lite/example',
    vizId: 'example',
    title: 'Example',
  },
});
```

Runnable example:

- `examples/vega-lite-gallery`

## Related docs

- [Providers](../../docs/providers/index.md)
- [Examples](../../docs/examples/index.md)
- [Tool Contract](../../docs/reference/tool-contract.md)
