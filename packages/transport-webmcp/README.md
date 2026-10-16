# @vacp/transport-webmcp

Expose a live VACP graph as browser-native WebMCP tools.

```ts
import { installVacpWebMcp } from '@vacp/transport-webmcp';

const exposure = await installVacpWebMcp(runtime, { onError: (cause) => console.error(cause) });
```

The installer registers `vacp.observe`, `vacp.capabilities`, `vacp.state`, `vacp.progress`, and one tool per available semantic action. The graph and state readers take the input fields of `vacp_capabilities` and `vacp_state`, and every state read carries a token. The installer follows capability changes, forwards cancellation to action handlers, and removes its tools when disposed, when `signal` aborts, or when the runtime ends. Unsupported browsers return `undefined`.

Options are `actor`, the attribution of every step and sentence, `vacpAgentActor` by default; `namespace`, `vacp` by default; `onError` for failed automatic registrations; `signal`; and `context`, the registry, `document.modelContext` by default. An action whose parameters form an object schema takes its inputs beside `narration`, and any other action takes them under `params`. An action result that arrived is the tool's answer, even when the caller aborted after completion.

`compileVacpWebMcpTools(graph, client, { actor, namespace })` provides the same executable projection without browser access or registration. Custom hosts can consume the returned tools directly.

This package targets the `document.modelContext.registerTool(tool, { signal })` API in the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) dated September 17, 2026. See the [WebMCP guide](../../docs/agents/webmcp.md) for input conventions, lifecycle, browser support, and examples.
