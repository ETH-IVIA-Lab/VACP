# Connect an agent

Agents use `vacp_observe`, `vacp_capabilities`, `vacp_state`, and `vacp_execute`. Each transport forwards those operations to the visualization's bridge. Every action call carries a `narration` sentence for the step, and each transport also offers `vacp_progress` for an opening and a closing sentence. The person watching follows each step in the [presence bubble](../presence/#report-thinking-and-public-progress), and replay shows the same words per step.

## External agents through MCP

From a local VACP checkout, install the Python package and Chromium:

```bash
uv sync --package vacp --locked
uv run --package vacp playwright install chromium
uv run --package vacp vacp --url http://127.0.0.1:5173/vgplot/
```

The server uses Playwright to reach the bridge. Its CLI supports stdio and HTTP transports, browser launch, and attachment to an existing Chromium session. Run `uv run --package vacp vacp --help` for connection options.

## In-page agents

Use `@vacp/transport-bridge` to adapt a bridge to the tool contract:

```ts
import { getVacpBridge } from '@vacp/runtime-browser';
import { createVacpTransport } from '@vacp/transport-bridge';

const bridge = getVacpBridge();
if (!bridge) throw new Error('VACP is not installed');

const transport = createVacpTransport(bridge);
const state = await transport.vacp_state();
```

`@vacp/agent-ai-sdk` connects this transport to an AI SDK agent or tool set. The bridge is also the activity channel that narrates the agent's turns:

```ts
import { createVacpAgentTools } from '@vacp/agent-ai-sdk';

const { tools, end } = createVacpAgentTools({ transport, activity: bridge });
```

Call `end(outcome)` when the agent's turn ends. `createVacpToolLoopAgent` does this for its own requests.

See the [tool contract](../reference/tool-contract) for request and response shapes.

## Browser-native tools

Use [WebMCP](webmcp) to expose the live VACP graph and semantic actions through the browser's `document.modelContext` API.
