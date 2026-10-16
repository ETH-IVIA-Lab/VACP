# @vacp/transport-webmcp

Expose a live VACP graph as browser-native WebMCP tools.

```ts
import { installVacpWebMcp } from '@vacp/transport-webmcp';

const exposure = await installVacpWebMcp(runtime, { onError: (cause) => console.error(cause) });
```

The installer registers `vacp.observe`, `vacp.capabilities`, `vacp.state`, `vacp.progress`, and one tool per available semantic action. The state reader takes the input fields of `vacp_state`, and the graph reader those of `vacp_capabilities` except `includeActions`, since operations are their own tools. Every state read carries a token. The installer follows capability changes, forwards cancellation to action handlers, and removes its tools when disposed, when `signal` aborts, or when the runtime ends. Unsupported browsers return `undefined`.

The options are `actor`, `namespace`, `onError`, `signal`, and `context`. `actor` attributes every step and sentence and defaults to `vacpAgentActor`. `namespace` defaults to `vacp`, `onError` receives failed automatic registrations, and `context` is the registry, `document.modelContext` by default. An action whose parameters form a plain object schema takes its inputs beside `narration`. A scalar schema, a `narration` property, a `$ref`, or a whole-object constraint such as `additionalProperties` keeps them under `params`. An action result that arrived is the tool's answer, even when the caller aborted after completion.

`compileVacpWebMcpTools(graph, client, { actor, namespace })` returns the three readers and the operation tools without browser access or registration. The installer adds `vacp.progress` and its narration binding. Custom hosts can consume the returned tools directly.

This package targets the `document.modelContext.registerTool(tool, { signal })` API in the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) dated September 17, 2026. See the [WebMCP guide](../../docs/agents/webmcp.md) for input conventions, lifecycle, browser support, and examples.
