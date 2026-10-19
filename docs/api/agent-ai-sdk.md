# @ethivia/vacp-ai-sdk

An agent built on the [AI SDK](https://ai-sdk.dev) that works through the VACP agent tools. [Connect an agent](../agents/#agents-inside-the-page) shows a complete setup.

## createVacpToolLoopAgent

```ts
createVacpToolLoopAgent(options: VacpAgentOptions): ToolLoopAgent
```

| Option                                             | Default                        | Meaning                                                                                                                               |
| -------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                                            |                                | Any AI SDK `LanguageModel`                                                                                                            |
| `transport`                                        |                                | The tools' route to the page: `createVacpTransport(bridge)`                                                                           |
| `instructions`                                     | `defaultVacpAgentInstructions` | The system instructions                                                                                                               |
| `maxSteps`                                         | 8                              | Model calls per request                                                                                                               |
| `temperature`                                      | 0.2                            | Sampling temperature                                                                                                                  |
| `maxOutputTokens`, `maxRetries`, `providerOptions` |                                | Passed to the AI SDK                                                                                                                  |
| `telemetry`                                        | Registered integrations        | AI SDK telemetry settings, such as `@ai-sdk/otel`                                                                                     |
| `activity`                                         |                                | `{ control, actor? }`: each request opens one turn for `actor`, `vacpAgentActor` by default, and closes it with the request's outcome |

Returns an AI SDK `ToolLoopAgent` with the five VACP tools. Call `agent.generate({ prompt })` or `agent.stream({ prompt })`. With `activity`, a request that completes, fails, or is cancelled closes its turn with that outcome, even when the model never calls `vacp_progress` with `done`.

## createVacpChatRuntime

```ts
createVacpChatRuntime(options: VacpAgentOptions & { contextCompactionPolicy?: VacpContextCompactionPolicy }): {
  agent: ToolLoopAgent;
  transport: ChatTransport<VacpChatMessage>;
}
```

Returns the agent and a chat transport for the AI SDK's `useChat`. With `activity`, each chat request opens and closes one turn, as for the standalone agent. Message metadata reports the provider, model, and token usage per step and in total.

`contextCompactionPolicy` bounds the history sent with each request. `defaultVacpContextCompactionPolicy` keeps the last turns' tool payloads within the tool result bounds, cuts their reasoning to 1,600 characters per part, and summarizes older payloads. Set `enabled: false` to send the full history.

## createVacpAgentTools

```ts
createVacpAgentTools(transport: VacpTransport): VacpAgentTools
```

Returns the five tools as AI SDK tools, with the shared descriptions and input schemas. `vacp_execute` and `vacp_progress` forward the AI SDK's abort signal to the transport.

## defaultVacpAgentInstructions

The instructions the agent receives without `instructions`: the shared tool guidance, plus rules to act through operations, find standard capabilities by contract, resolve widget labels through `vacp.widget_options`, and confirm outcomes with `vacp_state`.
