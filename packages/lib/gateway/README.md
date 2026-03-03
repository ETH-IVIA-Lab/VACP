# @vacp/gateway

## Purpose

In-page runtime for VACP.

This package installs the stable bridge (typically `window.__vacp`), validates action calls, and can optionally record history for debugging.

## When to use

- You want to expose a VACP bridge from an app.
- You are writing a provider that installs/updates `window.__vacp`.

## Conceptual model

- **Snapshots**: you provide functions that return capabilities and state.
- **Registry**: you register semantic actions with parameter validation.
- **Bridge**: the runtime exposes `getCapabilities`, `getState`, and `execute`.
- **Optional runtime**: history/time travel and other debug endpoints.

## Minimal usage

```ts
import { VacpActionRegistry, installVacpRuntimeBridge } from '@vacp/gateway';

const actions = new VacpActionRegistry();
actions.register({ name: 'app.ping', description: 'Ping', parameters: {} }, async () => ({ ok: true }));

installVacpRuntimeBridge({ snapshots: { getCapabilities, getState }, actions });
```

## Related docs

- [Core runtime](../../../docs/core-runtime/index.md)
- [Tool Contract](../../../docs/reference/tool-contract.md)
- [Configuration](../../../docs/reference/configuration.md)
- [Debug overlay](../../../docs/debug/index.md)
