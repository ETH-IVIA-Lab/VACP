# Transports

VACP lives in the page. A transport is how another process reaches the in-page contract.

Transports in this repo expose the same tool surface:

```text
vacp_capabilities(options?)
vacp_state(options?)
vacp_execute(name, params?, call_id?)
```

These tools call the in-page bridge and return structured snapshots and action results. The meaning of the contract stays the same across transports.

## MCP transport

The MCP transport is a Python server that drives a browser through Playwright and forwards tool calls into the page. Use it when the agent runs outside the browser process.

## In-page transport

The in-page transport calls the same bridge from browser JavaScript. It is used by the debug overlay and is useful when you want an embedded tool loop.
