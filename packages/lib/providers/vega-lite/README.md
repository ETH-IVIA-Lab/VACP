# @vacp/vega-lite

## Purpose

VACP provider for interactive Vega-Lite/Vega views.

This provider connects to a Vega `View` and exposes a stable VACP bridge with capabilities, state, and semantic actions.

## When to use

- You render Vega-Lite (or Vega) and want agent-ready semantics.
- You want to control parameters and selections through semantic actions.

## Conceptual model

This provider maps the Vega runtime into VACP:

- views/params/selections become graph nodes with stable refs,
- param and selection values appear in the state snapshot,
- semantic actions set params and clear selections.

## Minimal usage

After you have a Vega `View` (for example from `vega-embed`):

```ts
import { installVacpOnVegaLiteView } from '@vacp/vega-lite';

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

- `packages/examples/vega-lite-gallery`

## Related docs

- [Providers](../../../../docs/providers/index.md)
- [Examples](../../../../docs/examples/index.md)
- [Tool Contract](../../../../docs/reference/tool-contract.md)
