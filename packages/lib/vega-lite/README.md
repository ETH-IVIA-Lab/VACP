# @vacp/vega-lite

VACP provider for interactive Vega-Lite/Vega views.

This provider connects to a Vega `View` and exposes:

- a VACP graph (views, params, selections),
- live state snapshots (signals/params),
- semantic actions (set param, clear selection),
- a stable `window.__vacp` bridge for agents/tools.

## Intended usage

After you have a Vega `View` (e.g. from `vega-embed`), install VACP:

```ts
import { installVacpOnVegaLiteView } from '@vacp/vega-lite';

installVacpOnVegaLiteView({
  root,
  view,
  spec,
  options: {
    appId: 'vacp-examples',
    viewId: 'vega-lite/scatter-params',
    vizId: 'scatter-params',
    title: 'Scatter + param slider',
  },
});
```

Notes:

- Prefer rendering to **SVG** (`vega-embed` option `renderer: 'svg'`) so the provider can embed metadata and annotate DOM.
- This provider focuses on **Vega-Lite parameters**:
  - variable params → `Param` nodes
  - selection params → `Selection` nodes

## Actions exposed

The exact action set depends on the spec (which params exist), but typically includes:

- `vega_lite.set_param` (set a param by ref)
- `vega_lite.clear_selection` (clear a selection param by ref, when present)
- `vacp.apply_state` (dev-only: apply a state map to the live app)

For a runnable reference, see `packages/examples/vega-lite-gallery`.
