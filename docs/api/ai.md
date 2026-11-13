# @ethivia/vacp-ai

Runs an [AI SDK](https://ai-sdk.dev) agent in the page that works through the VACP [agent tools](./agent-tools). The AI SDK is a TypeScript library for calling language models. [Run an agent in the page](../agents/#run-an-agent-in-the-page) shows a complete setup.

```bash
pnpm add @ethivia/vacp-ai ai
```

`@ethivia/vacp-sdk` and `zod` are also peer dependencies. [Install](../install/) adds them.

## createVacpToolLoopAgent

```ts
createVacpToolLoopAgent(options: VacpAgentOptions): ToolLoopAgent
```

Creates an AI SDK `ToolLoopAgent` with the five VACP tools.

- `model` is any AI SDK `LanguageModel`. Required.
- `runtime` is the page the tools read and act on: the `VacpRuntime`, or the bridge [`getVacpBridge()`](./agent#getvacpbridge) returns. Required.
- `actor` names who the steps, sentences, and turns belong to. Defaults to `vacpAgentActor`.
- `instructions` replaces the system instructions. Defaults to [`defaultVacpAgentInstructions`](#defaultvacpagentinstructions).
- `maxSteps` limits the model calls per request. Defaults to `8`.
- `temperature` is the sampling temperature. Defaults to `0.2`.
- `maxOutputTokens`, `maxRetries`, and `providerOptions` pass through to the AI SDK.
- `telemetry` takes AI SDK telemetry settings, such as `@ai-sdk/otel`. Defaults to the integrations you registered with the AI SDK.

Call `agent.generate({ prompt })` or `agent.stream({ prompt })` on the returned agent. Each request opens one turn for `actor`. A request that completes, fails, or is cancelled closes its turn with that outcome, even when the model never calls `vacp_progress` with `done`.

## createVacpChatTransport

```ts
createVacpChatTransport(options: VacpChatTransportOptions): { agent: ToolLoopAgent; transport: ChatTransport<VacpChatMessage> }
```

Creates the same agent and a chat transport for the AI SDK's `useChat`.

- `VacpChatTransportOptions` adds `contextCompactionPolicy` to the [agent options](#createvacptoolloopagent). It defaults to [`defaultVacpContextCompactionPolicy`](#defaultvacpcontextcompactionpolicy).
- Each chat request opens and closes one turn.

Each `VacpChatMessage` carries `VacpChatMessageMetadata` with `provider`, `model`, `stepUsage`, `totalUsage`, and `finishedAt`. The usage fields are `VacpTokenUsage` objects.

## createVacpAgentTools

```ts
createVacpAgentTools(runtime: VacpToolBridge, options?: { actor?: VacpActor }): VacpAgentTools
```

Returns the five tools as AI SDK tools over [`createVacpToolHandlers`](./agent#createvacptoolhandlers), with the shared descriptions and input schemas, for a host that runs its own model loop. `vacp_execute` and `vacp_progress` forward the AI SDK's abort signal to the runtime. The host opens its own turns.

## defaultVacpContextCompactionPolicy

The `VacpContextCompactionPolicy` that bounds the history sent with each chat request.

- `enabled` turns compaction on. Defaults to `true`. `false` sends the full history.
- `maxTurns` is the number of latest user turns that keep their detail. Defaults to `8`. Older turns lose reasoning and replace each tool call with a text summary.
- `preserveFullToolPayloadTurns` is the number of latest assistant messages that keep whole tool parts. Defaults to `2`.
- `preserveReasoningTurns` is the number of latest assistant messages that keep reasoning. Defaults to `1`.
- `maxTextCharsPerPart` truncates each text and reasoning part. Defaults to `1600`.
- `maxToolJsonCharsPerPart` truncates the input and the output in a tool summary. Defaults to `1200`.

Tool payloads that stay whole are bounded the same way as tool results.

## wrapTransportWithVacpContextCompaction

```ts
wrapTransportWithVacpContextCompaction(transport: ChatTransport<Message>, policy?: VacpContextCompactionPolicy, options?: VacpContextCompactionOptions): ChatTransport<Message>
```

Compacts the messages of each `sendMessages` call before it reaches `transport`. `createVacpChatTransport` applies it for you.

- `policy` overrides fields of `defaultVacpContextCompactionPolicy`. With `enabled: false`, the function returns `transport` unchanged.
- `options.availableToolNames` lists the tools the agent still has. Tool parts that name any other tool become text summaries.

Throws an error that lists the three latest messages when the AI SDK rejects the compacted prompt.

## defaultVacpAgentInstructions

The string an agent receives when `instructions` is unset. It holds the shared tool guidance, plus rules to act through actions, find standard capabilities by contract, resolve widget labels through `vacp.widget_options`, and confirm outcomes with `vacp_state`.

## vacpAgentDefaults

`{ maxSteps: 8, temperature: 0.2 }`, the loop settings an agent uses when you leave them unset.
