# @ethivia/vacp-ai-sdk

Give an [AI SDK](https://ai-sdk.dev) agent the five VACP tools, with context compaction and public progress for the person watching.

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVacpToolLoopAgent } from '@ethivia/vacp-ai-sdk';
import { createVacpTransport } from '@ethivia/vacp-bridge';

const provider = createOpenAICompatible({ name: 'gateway', baseURL, apiKey });
const agent = createVacpToolLoopAgent({
  model: provider.chatModel('gpt-6-luna'),
  transport: createVacpTransport(runtime),
  activity: { control: runtime },
});
const { text } = await agent.generate({ prompt: 'Which cluster has the heaviest cars?' });
```

`createVacpToolLoopAgent` returns an AI SDK `ToolLoopAgent` over the tools of the [tool contract](../../docs/api/agent-tools.md). `model` is any AI SDK `LanguageModel`. `instructions` replaces `defaultVacpAgentInstructions`, which carry the shared `vacpAgentToolGuidance`. `maxSteps` defaults to 8 and `temperature` to 0.2, as `vacpAgentDefaults` records. `maxOutputTokens`, `maxRetries`, and `providerOptions` pass through to the model calls.

With `activity: { control: runtime }`, each `generate()` or `stream()` request opens one turn and closes it as completed, failed, or cancelled. Set `activity.actor` to the actor used by the transport when it differs from `vacpAgentActor`.

`createVacpChatRuntime` returns the same agent with an AI SDK chat transport for `useChat`. It accepts `contextCompactionPolicy`, which bounds the chat history sent with each request. With `activity: { control: runtime }`, each chat request opens one turn for the transport's actor and the request's outcome closes it: completed, failed, or cancelled.

A host that runs its own model loop uses `createVacpAgentTools(transport)`, which returns the tools.

See [agent connections](../../docs/agents/index.md) for the transports.

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

Every `vacp_execute` call carries a `narration` sentence for its step, which shows as the step begins and stays with the step's record. `vacp_progress` adds an opening and a closing sentence, spoken through the runtime's `narrate()`. Steps and sentences are attributed to the transport's actor, `vacpAgentActor` unless `createVacpTransport(bridge, { actor })` names another, so an agent's first step or sentence opens its turn and later ones join it. `vacp_execute` and `vacp_progress` forward the request's abort signal, so a cancelled request cancels its running step. Only the model's own sentences reach the person. Reasoning and response tokens remain in the chat stream and are never copied into presence bubbles.

For host-authored progress, use `runtime.beginAgentActivity()` as described in the [presence guide](../../docs/presence/index.md).
