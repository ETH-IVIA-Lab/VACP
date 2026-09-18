# Connect an agent

Agents use three tools: `vacp_capabilities`, `vacp_state`, and `vacp_execute`. Each transport forwards those operations to the visualization's bridge.

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

`@vacp/agent-ai-sdk` connects this transport to an AI SDK agent or tool set:

```ts
import { createVacpTools } from '@vacp/agent-ai-sdk';

const tools = createVacpTools({ transport });
```

The Inspector's Chat feature provides an in-page interface for configuring a model, running conversations, and reading tool traces. Requests are sent to the configured model endpoint.

See the [tool contract](../reference/tool-contract) for request and response shapes.
