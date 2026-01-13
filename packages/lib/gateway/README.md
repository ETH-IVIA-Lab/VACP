# @vacp/gateway

In-page runtime for VACP: action execution + optional history/time travel.

This is what turns “protocol types” into a practical app integration:

- register and validate semantic actions (`VacpActionRegistry`)
- install a stable bridge (`installVacpRuntimeBridge`)
- optionally keep a timeline of snapshots/actions for debugging (`getRuntime`, `undo`, `redo`, overrides)

## Minimal usage

```ts
import { VacpActionRegistry, installVacpRuntimeBridge } from '@vacp/gateway';

const actions = new VacpActionRegistry();
actions.register({ name: 'app.ping', description: 'Ping', parameters: {} }, async () => ({ ok: true }));

installVacpRuntimeBridge({ snapshots: { getCapabilities, getState }, actions });
```

The returned `window.__vacp` is what the MCP server and debug UI talk to.

By default, `installVacpRuntimeBridge` also injects a `type="application/json"` `<script>` tag
(`id="__vacp_snapshot"`) whose text content is pure JSON containing `{ capabilities, state }`.
Disable via `injectDomSnapshot: false` (or set `VACP_DOM_SNAPSHOT=0` / `?vacp-dom-snapshot=0`).

If you pass `injectDomSnapshot`, it takes precedence over env/URL config.
