# VACP

VACP makes an interactive visualization “agent-ready” without pixel-based automation.

It does this by giving the app a small, stable API surface:

- **Capabilities**: what is on the page, and what actions exist?
- **State**: what is currently selected / configured?
- **Actions**: semantic operations (e.g. “set interval selection”), not DOM events.

Agents, humans, and debugging tools all interact with the same contract.

## The Core Idea (One Sentence)

Instead of clicking pixels, an agent calls `window.__vacp.execute({ name, params })` (usually via MCP), and the app runs the _same_ semantic interactions a human would.

## Quick Start

From `vacp/`:

- Install JS deps: `pnpm install`
- Install Python env: `uv sync`
- Run all example smoke tests: `pnpm test:examples` (spins up each demo and validates bidirectionality)

Run an example app:

- `pnpm -C packages/examples/mosaic-gallery dev`
- `pnpm -C packages/examples/vega-lite-gallery dev`
- `pnpm -C packages/examples/d3-scatter-lasso dev`

Enable the in-page overlay:

- Add `?vacpDebug=1` to the URL
- Click the “VACP” button to inspect the graph, timeline, demos, and dispatch actions manually
- Use `JSON → Apply state to live app` (opt-in) to apply edited state maps during development

Run the MCP server:

- Start an example (above), then in another terminal: `uv run vacp-mcp-server --url http://localhost:5173/`
- The MCP endpoint defaults to `http://localhost:8000/mcp`

For interactive development, it’s often nicer to attach to an existing Chrome via CDP:

- See `vacp/packages/vacp-mcp-server/README.md`

## How It Works (Plain Version)

VACP has two layers:

1. **Protocol (inside the app)** — TypeScript packages:
   - `@vacp/core`: types (graph, state snapshots, actions)
   - `@vacp/gateway`: runtime bridge + action registry + history (undo/time travel support)
   - `@vacp/dom`: optional DOM/SVG annotations and embedded SVG metadata
2. **Transport (optional)** — ways to reach the app from an agent:
   - `vacp-mcp-server`: exposes the protocol over MCP by driving a browser via Playwright

MCP is “just a wire”. The protocol lives in the app.

## Where To Read Next

- System overview: `vacp/ARCHITECTURE.md`
- Deep dive (flows, rationale, extension points): `vacp/ARCHITECTURE_DETAILS.md`
- Runnable demos: `vacp/packages/examples/README.md`
- MCP server: `vacp/packages/vacp-mcp-server/README.md`

## Repository Layout

- `vacp/packages/lib/*`: TypeScript workspace (pnpm)
- `vacp/packages/examples/*`: runnable demos (also serve as regression tests)
- `vacp/packages/vacp-mcp-server`: Python MCP transport (uv)
