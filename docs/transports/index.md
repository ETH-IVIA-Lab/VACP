# Transports

VACP lives in the page. A transport is how another process reaches the in-page contract.

Transports in this repo share the same bridge tool surface:

```text
vacp_capabilities(options?)
vacp_state(options?)
vacp_execute(name, params?, call_id?)
```

These bridge tools call the in-page bridge and return structured snapshots and action results. Transport-specific helpers can add navigation or page inspection without changing the VACP contract.

For unscoped reads, transports should omit scope fields instead of using bare `vacp://`.

## MCP transport

The MCP transport is a Python server that drives a browser through [Playwright](https://playwright.dev/) and forwards tool calls into the page. It follows [Model Context Protocol](https://modelcontextprotocol.io/) and is implemented in `packages/lib/transports/mcp-server`.
Use it when the agent runs outside the browser process.

## In-page transport

The in-page transport calls the same bridge from browser JavaScript. In this repo it lives in `packages/lib/transports/agent-client`.
The debug overlay uses it, and embedded agent clients can use it without leaving the browser process.
