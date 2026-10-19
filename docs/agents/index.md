# Connect an agent

An agent reaches a page's runtime through five shared tools. Pick the transport by where the agent runs:

| Agent                                                                         | Transport                    | Package                |
| ----------------------------------------------------------------------------- | ---------------------------- | ---------------------- |
| An [MCP](https://modelcontextprotocol.io) client such as Claude Code or Codex | MCP server driving a browser | `vacp` (Python)        |
| An agent you run inside the page                                              | AI SDK tools over the bridge | `@ethivia/vacp-ai-sdk` |
| A browser agent that reads the page's tools                                   | WebMCP                       | `@ethivia/vacp-webmcp` |

The MCP server and the AI SDK tools offer these tools with the same descriptions, defined once in `@ethivia/vacp-protocol`. The MCP server adds `vacp_open_url` and `vacp_page_info`, and [WebMCP](./webmcp) registers one tool per operation in place of `vacp_execute`:

```text
vacp_observe()
vacp_capabilities({ refs?, prefixes?, kinds?, layers?, includeActions?, includeEdges?, includeNodeData? })
vacp_state({ since?, refs?, includeSummary? })
vacp_execute({ name, params?, narration, call_id? })
vacp_progress({ message, done? })
```

`vacp_execute` requires `narration`, one sentence for the person watching about what the step does. The agent calls `vacp_progress` once before its first step and once with `done: true` when the request is finished. [Core concepts](../concepts/#actors-turns-and-narration) defines turns. The [agent tools reference](../api/agent-tools) gives the inputs, results, and size bounds.

## External agents through MCP

The Python server opens the page in Chromium through [Playwright](https://playwright.dev), a browser automation library, and serves the page's runtime as MCP tools. From a checkout of the repository:

```bash
uv run --package vacp playwright install chromium
uv run --package vacp vacp --url https://examples.vacp.dev/athletes/
```

The server listens at `http://localhost:8000/mcp`. Pass `--transport stdio` for clients that start the server as a subprocess, `--headless` to hide the browser window, and `--cdp-url http://localhost:9222` to attach to a Chromium you already run. Run `uv run --package vacp vacp --help` for every option. [Get started](../get-started/#connect-an-agent-through-mcp) registers the server with Claude Code.

## Agents inside the page

`@ethivia/vacp-bridge` maps the tools onto a page bridge. `@ethivia/vacp-ai-sdk` turns them into [AI SDK](https://ai-sdk.dev) tools and an agent:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVacpChatRuntime, createVacpToolLoopAgent } from '@ethivia/vacp-ai-sdk';
import { getVacpBridge } from '@ethivia/vacp-browser';
import { createVacpTransport } from '@ethivia/vacp-bridge';

const bridge = getVacpBridge();
if (!bridge) throw new Error('VACP is not installed on this page');

// baseURL and apiKey name your OpenAI-compatible model gateway.
const model = createOpenAICompatible({ name: 'gateway', baseURL, apiKey }).chatModel('gpt-5.5');
const agent = createVacpToolLoopAgent({ model, transport: createVacpTransport(bridge), activity: { control: bridge } });
const result = await agent.generate({ prompt: 'Which sports have the tallest athletes?' });
```

`model` accepts any AI SDK language model. `activity` opens one turn per request and closes it with the request's outcome, so presence and replay group the request's steps. The default instructions teach the agent the tool contract. Pass `instructions` to replace them with your own.

For a chat interface, `createVacpChatRuntime(options)` returns the agent and an AI SDK chat transport for `useChat`, with the same options:

```ts
const { transport } = createVacpChatRuntime({
  model,
  transport: createVacpTransport(bridge),
  activity: { control: bridge },
});
```

`createVacpAgentTools(transport)` returns the five tools alone, for an agent you assemble yourself. `vacp_execute` and `vacp_progress` forward the AI SDK's abort signal, so stopping a request cancels the step it is running.

## Browser-native tools

[WebMCP](./webmcp) registers each available operation as its own tool with the browser, through `document.modelContext`.

## Attribution

Every transport attributes its calls to one actor, `vacpAgentActor` from `@ethivia/vacp-protocol`, unless the host passes another: `createVacpTransport(bridge, { actor })` or `installVacpWebMcp(runtime, { actor })`. Presence groups steps and sentences by actor ID. The host sets the actor. Model output never does.
