# @vacp/transport-bridge

Map a VACP bridge to the `vacp_observe`, `vacp_capabilities`, `vacp_state`, and `vacp_execute` tools of the [tool contract](../../docs/reference/tool-contract.md).

```ts
import { createVacpTransport } from '@vacp/transport-bridge';

const transport = createVacpTransport(bridge);
const read = await transport.vacp_capabilities({ refs: ['vacp://'] });
```

Each method takes the tool's input as a model sent it. A bare `vacp://` scope reads everything, and an unscoped capabilities read leaves out node data unless `includeNodeData` is true. Graph reads leave out source ownership, and every answer is JSON cut to the limits of `vacpToolResult` from `@vacp/protocol`. `vacp_execute` trims the action name and gives a call without `call_id` a random one. The transport depends on protocol types and on no model SDK. See [agent connections](../../docs/transports/index.md).
