# @vacp/agent-ai-sdk

Connect VACP tools to an AI SDK agent with model configuration, interaction policy, context compaction, and tool tracing.

```ts
import { createVacpTools } from '@vacp/agent-ai-sdk';
import { createVacpTransport } from '@vacp/transport-bridge';

const tools = createVacpTools({ transport: createVacpTransport(bridge) });
```

`createVacpAgent` composes the model and tools into an agent. Tool traces preserve both requested and effective input when normalization changes a request.

See [agent connections](../../docs/transports/index.md) and the [tool contract](../../docs/reference/tool-contract.md).
