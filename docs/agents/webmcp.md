# WebMCP

`installVacpWebMcp` registers each available action on your page as a tool for agents that run in the browser. [WebMCP](https://webmachinelearning.github.io/webmcp/) is a proposed browser API, `document.modelContext`, through which a page offers tools to such agents.

```ts
import { installVacpWebMcp } from '@ethivia/vacp-sdk/agent';

const webmcp = await installVacpWebMcp(runtime, {
  onError: (cause) => console.error('WebMCP registration failed', cause),
});

// When the view unmounts:
webmcp?.dispose();
```

`runtime` comes from `const { runtime } = installVacpRuntime(...)`. The promise resolves once the first registration completes, and rejects if it fails. It resolves to `undefined` in a browser without `document.modelContext`, so the same code runs everywhere. `onError` receives failures of later registrations. Calls run through the runtime, so presence, provenance, and availability checks apply as they do for every other agent.

## Tools the agent sees

| Tool                | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `vacp_observe`      | Reads the graph, state, and freshness                          |
| `vacp_capabilities` | Reads the graph, scoped as requested                           |
| `vacp_state`        | Reads state, or the changes since a state token                |
| `vacp_progress`     | Shows an opening or closing sentence to the person watching    |
| `vacp_<name>`       | Runs one action with its parameters and a `narration` sentence |

The reads and `vacp_progress` carry the names the [MCP server](./#connect-an-mcp-client) and the AI SDK tools use. An action tool spells each `.` of the action name as `_`, so `threshold.set` becomes `vacp_threshold_set`. Every name fits the `[A-Za-z0-9_-]{1,64}` rule of model APIs, so a browser agent can hand the catalog to its model as registered. The graphs these tools return leave actions out, because each action is its own tool. The installation follows the runtime. An action that becomes available gains a tool, and one that becomes unavailable loses it. A call without a valid `narration` returns an error result and runs nothing, so the agent can read the message and retry. The [WebMCP reference](../api/agent#installvacpwebmcp) gives the input rules for each action tool.

## Name and attribute the tools

Pass `namespace` to give each runtime its own tool prefix, such as `namespace: 'sales'` for `sales_observe`. Pass `actor` to attribute the calls to someone other than `vacpAgentActor`.

## Remove the tools

`webmcp.dispose()` removes the tools and leaves the runtime running. Disposing the runtime, or aborting a `signal` you pass in the options, removes them as well.

## Try it in Chromium

Chromium implements WebMCP behind flags. Start Chromium with these two flags, then open any page that runs VACP, such as the [example gallery](https://examples.vacp.dev/):

```text
--enable-experimental-web-platform-features --enable-features=WebMCPTesting
```

Every example registers its tools in a browser that supports the API. The WebMCP [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) tracks other browsers.

## Next

- [Show the agent's steps with presence](../presence/)
- [WebMCP reference](../api/agent#installvacpwebmcp)
