# Connect an agent

Every path gives the agent the same actions. Pick the one that matches where the agent runs.

## MCP client

The `vacp` Python package runs an [MCP](https://modelcontextprotocol.io) server, the protocol clients such as Claude Code, Codex, and Cursor use to call external tools. The server opens your page through [Playwright](https://playwright.dev), a browser automation library, and calls `window.__vacp`, so the page must install with `exposeBridge: true`. [uv](https://docs.astral.sh/uv/) runs it with `uvx`.

```bash
uvx --from 'vacp[server]' playwright install chromium
claude mcp add vacp -- uvx --from 'vacp[server]' vacp --url http://localhost:5173/
```

The client starts the server as a subprocess and talks to it over stdio. Other MCP clients take the same command in their server settings. The server waits for the page bridge before it serves tools. For a client that connects over HTTP, add `--transport http`: the server listens at `http://localhost:8000/mcp`, and `GET /healthz` answers when it is up.

| Option                      | Use it to                                                                    |
| --------------------------- | ---------------------------------------------------------------------------- |
| `--headless`                | Run the browser without a window                                             |
| `--startup-wait-for-bridge` | Hold the tools until `window.__vacp` exists                                  |
| `--cdp-url <url>`           | Attach to a running Chromium, such as `http://localhost:9222`                |
| `--global-key <key>`        | Read a bridge installed under another `globalKey`                            |
| `--host`, `--port`          | Bind HTTP elsewhere. `0.0.0.0` accepts other machines with no authentication |

`--enable-browser-tools` adds screenshot, eval, click, fill, and press tools, which run arbitrary script in the page. Enable it only for clients you trust with the page.

## An agent inside the page

The [AI SDK](https://ai-sdk.dev) is Vercel's TypeScript library for model calls and tool loops.

```bash
pnpm add @ethivia/vacp-ai ai @ai-sdk/openai-compatible
```

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVacpToolLoopAgent } from '@ethivia/vacp-ai';
import type { VacpRuntime } from '@ethivia/vacp-sdk';

declare const runtime: VacpRuntime;

const gateway = createOpenAICompatible({ name: 'gateway', baseURL: '/api/llm' });
const agent = createVacpToolLoopAgent({ model: gateway.chatModel('your-model-id'), runtime });
const result = await agent.generate({ prompt: 'Which regions have the largest accounts?' });
console.log(result.text);
```

`runtime` comes from `const { runtime } = installVacpRuntime(...)`, so this path works with `exposeBridge: false`. `model` takes any AI SDK language model. The model calls run in the browser, so route them through an endpoint you control, here `/api/llm`, and keep provider keys on the server. The agent opens one turn per request, so presence and replay group the request's steps. The default `maxSteps` is 8.

For a chat interface, `createVacpChatTransport` takes the same options and returns `{ agent, transport }`. Pass `transport` to the AI SDK's `useChat`.

## WebMCP

[WebMCP](https://webmachinelearning.github.io/webmcp/) is a proposed browser API, `document.modelContext`, through which a page offers tools to agents that run in the browser.

```ts
import type { VacpRuntime } from '@ethivia/vacp-sdk';
import { installVacpWebMcp } from '@ethivia/vacp-sdk/agent';

declare const runtime: VacpRuntime;

const webmcp = await installVacpWebMcp(runtime, {
  onError: (cause) => console.error('WebMCP registration failed', cause),
});

// When the view unmounts:
webmcp?.dispose();
```

The promise resolves to `undefined` in a browser without `document.modelContext`, so the same code runs everywhere. To try it, start Chromium with `--enable-experimental-web-platform-features --enable-features=WebMCPTesting`.

WebMCP registers `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_progress`, and one tool per available action, named `vacp_` and the action name with each `.` as `_`, such as `vacp_threshold_set` for `threshold.set`. A call without a valid `narration` returns an error and runs nothing.

## The agent tools

| Tool                | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `vacp_observe`      | Reads the graph, state, and freshness in one call                  |
| `vacp_capabilities` | Reads the graph, scoped by refs, prefixes, kinds, or layers        |
| `vacp_state`        | Reads state, or the changes since a state token                    |
| `vacp_execute`      | Runs one action by `name` with `params` and a `narration` sentence |
| `vacp_progress`     | Shows an opening or closing sentence to the person watching        |

The MCP server adds `vacp_open_url` and `vacp_page_info`.

## Narration

Each `vacp_execute` call carries `narration`, one sentence of at most 280 characters. The agent calls `vacp_progress` once before its first step and once with `done: true` when it finishes. `defaultVacpAgentInstructions` from `@ethivia/vacp-ai` teaches a model both rules, and it is the default for `instructions`. For other agents, add `vacpAgentToolGuidance` and `vacpNarrationGuidance` from `@ethivia/vacp-sdk/agent` to the system prompt.

Calls are attributed to `vacpAgentActor`. Pass `actor` to `createVacpToolLoopAgent` to name another agent.

## Check the connection

Ask the agent for a specific change, such as "Set the minimum to 25." Confirm that it called `vacp_execute`, that the control or chart on the page changed, and that the last `action` record in `getProvenance()` has `execution.actor.kind` set to `agent`.
