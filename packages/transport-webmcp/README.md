# @vacp/transport-webmcp

Expose a live VACP graph as browser-native WebMCP tools.

```ts
import { installVacpWebMcp } from '@vacp/transport-webmcp';

const exposure = await installVacpWebMcp(integration.bridge);
```

The installer registers graph and state readers plus one tool per selected semantic action. It follows capability changes, forwards cancellation to action handlers, and removes its tools when disposed or when the runtime ends. Unsupported browsers return `undefined`.

`compileVacpWebMcpTools(graph, client, options)` provides the same executable projection without browser access or registration. Custom hosts can consume the returned tools directly.

This package targets the `document.modelContext.registerTool(tool, { signal })` API in the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) dated September 17, 2026. See the [WebMCP guide](../../docs/transports/webmcp.md) for input conventions, lifecycle, browser support, and examples.
