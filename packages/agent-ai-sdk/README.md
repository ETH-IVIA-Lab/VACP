# @vacp/agent-ai-sdk

Give an [AI SDK](https://ai-sdk.dev) agent the VACP tools, with interaction policy, context compaction, and public progress for the person watching.

```ts
import { createVacpLLMModel, createVacpToolLoopAgent } from '@vacp/agent-ai-sdk';
import { createVacpTransport } from '@vacp/transport-bridge';

const agent = createVacpToolLoopAgent({
  model: createVacpLLMModel(config),
  transport: createVacpTransport(bridge),
  activity: runtime,
});
const { text } = await agent.generate({ prompt: 'Which cluster has the heaviest cars?' });
```

`createVacpToolLoopAgent` returns an AI SDK `ToolLoopAgent` over the five tools of the [tool contract](../../docs/reference/tool-contract.md). `createVacpChatRuntime` returns the same agent with an AI SDK chat transport for `useChat`. `model` is any AI SDK `LanguageModel`. `createVacpLLMModel(config)` builds one from a `VacpLLMConfig`, which applications persist themselves. `maxSteps` defaults to 8 and `temperature` to 0.2, as `vacpAgentDefaults` records. `maxOutputTokens`, `maxRetries`, and `providerOptions` pass through to the model calls.

A host that runs its own model loop uses `createVacpAgentTools({ transport, activity, actor })`. It returns the `tools` and an `end(outcome)` the host calls when its turn ends.

See [agent connections](../../docs/transports/index.md) for the transports.

## Telemetry

Pass `telemetry` to `createVacpToolLoopAgent()` or `createVacpChatRuntime()` to report the agent's calls through [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry). With `@ai-sdk/otel`'s `OpenTelemetry` integration, each request becomes an `invoke_agent` span with a `step` span per model call, holding its `chat` span and one `execute_tool` span per VACP tool call:

```ts
import { OpenTelemetry } from '@ai-sdk/otel';

const agent = createVacpToolLoopAgent({
  model,
  transport,
  telemetry: { integrations: [new OpenTelemetry()], functionId: 'analysis-assistant' },
});
```

Integrations registered with `registerTelemetry()` apply when `telemetry` is omitted.

## Public progress

Every `vacp_execute` call carries a `narration` sentence for its step, which shows as the step begins and stays with the step's record. Pass `activity: runtime` and the agent also receives a `vacp_progress` tool for an opening and a closing sentence. Each request opens at most one activity for the agent's actor, `{ id: 'agent', label: 'Assistant' }` unless `actor` names another, and the request's outcome closes it: completed, failed, or cancelled. Every step is attributed to the same actor, so it joins the turn. Only the model's own sentences reach the person. Reasoning and response tokens remain in the chat stream and are never copied into presence bubbles.

For host-authored progress, use `runtime.beginAgentActivity()` as described in the [presence guide](../../docs/presence/index.md).
