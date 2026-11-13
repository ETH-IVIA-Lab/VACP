# Connect an agent

An agent reads and changes the analysis on your page through five VACP tools, and the person sees each step through [presence](../presence/). Connect the agent where it runs:

- An [MCP](https://modelcontextprotocol.io) client, such as Claude Code, Codex, or Cursor, uses the MCP server in the `vacp` Python package. MCP is the protocol these clients use to call external tools.
- An agent that runs in the page uses the [AI SDK](https://ai-sdk.dev) tools in `@ethivia/vacp-ai`. The AI SDK is Vercel's TypeScript library for model calls and tool loops.
- A browser agent reads the tools the page registers through [WebMCP](./webmcp).

## Connect an MCP client

The server reads the [page bridge](../concepts/#page-bridge), so install the runtime with `exposeBridge: true`. Run the server with [uv](https://docs.astral.sh/uv/), the Python package manager. The first command installs the Chromium the server drives. The second registers the server with Claude Code, which starts it as a subprocess and talks to it over stdio:

```bash
uvx --from 'vacp[server]' playwright install chromium
claude mcp add vacp -- uvx --from 'vacp[server]' vacp --url http://localhost:5173/
```

Other MCP clients take the same command in their server settings. The server opens the page in a Chromium window through [Playwright](https://playwright.dev), a browser automation library, and waits for the page bridge before it serves tools. For a client that connects over HTTP, run the command with `--transport http` and point the client at `http://localhost:8000/mcp`. The [`vacp` command reference](../api/python#the-vacp-command) lists every option.

## Run an agent in the page

```bash
pnpm add @ethivia/vacp-ai ai @ai-sdk/openai-compatible
```

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVacpToolLoopAgent } from '@ethivia/vacp-ai';

const gateway = createOpenAICompatible({ name: 'gateway', baseURL: '/api/llm' });
const agent = createVacpToolLoopAgent({ model: gateway.chatModel('gpt-5.5'), runtime });
const result = await agent.generate({ prompt: 'Which sports have the tallest athletes?' });
```

`runtime` comes from `const { runtime } = installVacpRuntime(...)`. `model` takes any AI SDK language model. The model calls run in the browser, so route them through an endpoint you control, here `/api/llm`, and keep provider keys on the server. The agent maps the five tools onto the runtime and opens one turn per request, so presence and replay group the request's steps.

For a chat interface, `createVacpChatTransport` takes the same options and returns `{ agent, transport }`. Pass `transport` to the AI SDK's `useChat`. The [AI SDK agent reference](../api/ai) lists every option.

## Try it without a model

`MockLanguageModelV3` from `ai/test`, the [AI SDK](https://ai-sdk.dev) test helper, scripts a model's replies, so you can run the agent loop with no provider or key. This one calls `vacp_execute` once and then finishes:

```ts
import { MockLanguageModelV3 } from 'ai/test';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const model = new MockLanguageModelV3({
  doGenerate: [
    {
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage,
      warnings: [],
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'vacp_execute',
          input: JSON.stringify({
            name: 'threshold.set',
            params: { value: 60 },
            narration: 'Raising the threshold to 60.',
          }),
        },
      ],
    },
    {
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
      content: [{ type: 'text', text: 'The threshold is 60.' }],
    },
  ],
});
```

Pass `model` wherever the example above passes a real one.

## The agent tools

| Tool                | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `vacp_observe`      | Reads the graph, state, and freshness in one call                  |
| `vacp_capabilities` | Reads the graph, scoped by refs, prefixes, kinds, or layers        |
| `vacp_state`        | Reads state, or the changes since a state token                    |
| `vacp_execute`      | Runs one action by `name` with `params` and a `narration` sentence |
| `vacp_progress`     | Shows an opening or closing sentence to the person watching        |

The MCP server adds `vacp_open_url` and `vacp_page_info`. WebMCP registers one tool per action in place of `vacp_execute`. The [agent tools reference](../api/agent-tools) gives the inputs, results, and size limits.

## Narration

Each `vacp_execute` call carries `narration`, one sentence of at most 280 characters that the bubble shows while the step runs and replay shows afterwards. The agent calls `vacp_progress` once before its first step and once with `done: true` when it finishes, which closes the turn. The default instructions in `@ethivia/vacp-ai` teach a model both rules.

Every call is attributed to `vacpAgentActor` unless you pass `actor` to `createVacpToolLoopAgent`.

## Next

- [Show the agent's steps with presence](../presence/)
- [Register tools with WebMCP](./webmcp)
