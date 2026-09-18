# @vacp/transport-bridge

Adapt a VACP bridge to the `vacp_capabilities`, `vacp_state`, and `vacp_execute` tool contract.

```ts
import { createVacpTransport } from '@vacp/transport-bridge';

const transport = createVacpTransport(bridge);
const state = await transport.vacp_state();
```

The transport waits for runtime readiness and restores live mode before agent actions. It depends on protocol types rather than a model SDK. See [agent connections](../../docs/transports/index.md).
