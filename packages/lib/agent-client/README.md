# @vacp/agent-client

## Purpose

Direct in-page transport for VACP-enabled apps.

This package calls `window.__vacp` from browser JavaScript and exposes the same semantic tool surface as the MCP transport.

## When to use

- You want an agent loop embedded in the app process.
- You are using the debug overlay Chat module.

For external agents, use `vacp-mcp-server` instead.

## Conceptual model

- The protocol lives inside the app.
- Transports are adapters that expose the same capabilities/state/execute operations.

## Minimal usage

Create a transport against the in-page bridge:

```ts
import { createWindowVacpTransport, createVacpTools } from '@vacp/agent-client';

const transport = createWindowVacpTransport(window.__vacp);
const tools = createVacpTools({ transport });
```

## Related docs

- [Transports](../../../docs/transports/index.md)
- [Tool Contract](../../../docs/reference/tool-contract.md)
