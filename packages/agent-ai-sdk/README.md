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

Pass `activity: runtime` to `createVacpChatRuntime()` or `createVacpToolLoopAgent()`. Every `vacp_execute` call then requires a `narration` sentence for its step, which shows as the step begins and stays with the step's record, and the agent receives a `vacp_progress` tool for an opening and a closing sentence. Each chat turn opens one activity for the agent's actor, `{ id: 'agent', label: 'Assistant' }` unless `actor` names another, and the stream's outcome closes it. Every step is attributed to the same actor, so it joins the turn. Only the model's own sentences reach the person, and stream cancellation releases the activity. Reasoning and response tokens remain in the chat stream and are never copied into presence bubbles.

For host-authored progress, use `runtime.beginAgentActivity()` as described in the [presence guide](../../docs/presence/index.md).
