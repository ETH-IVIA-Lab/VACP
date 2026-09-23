# @vacp/agent-ai-sdk

Connect VACP tools to an AI SDK agent with model configuration, interaction policy, context compaction, and tool tracing.

```ts
import { createVacpTools } from '@vacp/agent-ai-sdk';
import { createVacpTransport } from '@vacp/transport-bridge';

const tools = createVacpTools({ transport: createVacpTransport(bridge) });
```

`createVacpToolLoopAgent` composes the model and tools into an agent. `createVacpChatRuntime` also supplies an AI SDK chat transport. Applications pass model configuration explicitly and own its persistence. Tool traces preserve both requested and effective input when normalization changes a request.

See [agent connections](../../docs/transports/index.md) and the [tool contract](../../docs/reference/tool-contract.md).

## Public progress

Pass `activity: runtime` to `createVacpChatRuntime()` or `createVacpToolLoopAgent()`. The agent then receives a `vacp_progress` tool whose description asks for one short plain sentence to the person about the data and the view. Each chat turn opens one activity for actor `agent`, the default for direct VACP execution, and the stream's outcome closes it. The model's sentences take precedence over lifecycle wording, and stream cancellation releases the activity. Reasoning and response tokens remain in the chat stream and are never copied into presence bubbles.

For host-authored progress, use `runtime.beginAgentActivity()` as described in the [presence guide](../../docs/presence/index.md).
