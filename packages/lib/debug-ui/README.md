# @vacp/debug-ui

Optional in-page debug overlay for VACP.

It is provider-agnostic: it only talks to `window.__vacp` (the runtime bridge installed by `@vacp/gateway`).

## Enable

- set `VACP_DEBUG_UI=1`, or add `?vacp-debug=1` to the URL, or
- set localStorage `vacp:debug=1`

Notes:

- `enabled: 'auto'` reads the same config sources as above.
- If you use Vite and want `VACP_*` env vars to be readable in the browser, set `envPrefix: ['VITE_', 'VACP_']` in `vite.config.ts`.

The overlay button (“VACP” pill) is draggable and snaps to nearby anchors (corners/edges/center). The tools panel opens
next to the pill and stays within the viewport.

## What it shows

- **Graph**: rendered graph diagram (Mermaid → SVG)
- **Data**: pick a `DataHandle` and run DuckDB SQL via `vacp.data_sql` (includes selection preview)
- **Actions**: manual dispatch (no pixel automation)
- **History**: runtime controls + timeline + time travel (inspect cursor) + apply-to-live (“rewind”)
- **Playbook**: provider-supplied scripted stepper (shows “agent-like” sequences)
- **Chat**: AI SDK-powered client agent loop (direct transport to `window.__vacp`, OpenAI-compatible config)
- **JSON**: inspection overrides + opt-in apply-to-live

The overlay works best when the bridge supports `getRuntime()` and `getPlaybooks()`, but it
still functions with the minimal bridge (`getCapabilities/getState/execute`).

The Chat tab uses `@vacp/agent-client` and should be read as a second transport implementation:

- MCP transport: Python server + Playwright (`vacp-mcp-server`)
- Direct transport: in-page AI SDK tool loop (`@vacp/agent-client`)

Both call the same semantic VACP contract.

For a runnable reference, see any of the example apps under `packages/examples/*`.

## Shortcuts

When the tools panel is open:

- `Esc` closes it
- `Alt+1..9` selects modules by order
- `Alt+R` captures a fresh snapshot
