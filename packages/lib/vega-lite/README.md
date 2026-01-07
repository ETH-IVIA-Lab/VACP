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

installVacpOnVegaLiteView({ root, view, spec, options: { appId: 'vega-lite', viewId: 'demo' } });
```
