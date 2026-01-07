# VACP

VACP makes an interactive visualization “agent-ready” without pixel-based automation.

It does this by giving the app a small, stable API surface:

- **Capabilities**: what is on the page, and what actions exist?
- **State**: what is currently selected / configured?
- **Actions**: semantic operations (e.g. “set interval selection”), not DOM events.

Agents, humans, and debugging tools all interact with the same contract.

## Core idea

Instead of clicking pixels, an agent calls `window.__vacp.execute({ name, params })` (usually via MCP), and the app runs the _same_ semantic interactions a human would.

## What’s in this repo

- **Protocol + runtime (TypeScript)**: the in-app contract and history/time travel support (`packages/lib/*`).
- **Providers (TypeScript)**: first-class integrations for specific visualization stacks:
  - Mosaic/vgplot (`@vacp/mosaic`)
  - Vega-Lite/Vega params (`@vacp/vega-lite`)
  - a small “BYO provider” kit (`@vacp/kit`) used by the frameworkless examples
- **Transport (Python)**: `vacp-mcp-server` (Playwright + MCP), which lets an agent reach `window.__vacp`.
- **Examples**: runnable demos that double as smoke tests (`pnpm test:examples`).

## Quick start

From `vacp/`:

- Install JS deps: `pnpm install`
- Install Python env: `uv sync`
- Install Playwright browsers:
  - for web tests: `pnpm exec playwright install chromium`
  - for `vacp-mcp-server` (Python): `uv run playwright install chromium`
- Run web example smoke tests: `pnpm test:examples` (starts each demo and validates bidirectionality)
- Run MCP server tests: `pnpm test:server`

Run an example app:

- `pnpm -C packages/examples/mosaic-gallery dev`
- `pnpm -C packages/examples/vega-lite-gallery dev`
- `pnpm -C packages/examples/d3-scatter-lasso dev`
- `pnpm -C packages/examples/vanilla-minimal dev`

Enable the in-page overlay:

- Add `?vacpDebug=1` to the URL
- Click the “VACP” button to inspect the graph, timeline, demos, run DuckDB SQL, and dispatch actions manually
- Use `JSON → Apply state to live app` (opt-in) to apply edited state maps during development

Run the MCP server:

- Start an example (above), then in another terminal: `uv run vacp-mcp-server --url http://localhost:5173/`
- The MCP endpoint defaults to `http://localhost:8000/mcp`

For interactive development, it’s often nicer to attach to an existing Chrome via CDP:

- See `vacp/packages/vacp-mcp-server/README.md`

## Suggested exploration path

If you’re new to the repo, this is the fastest way to build a correct mental model:

1. Run `packages/examples/mosaic-gallery` and open the overlay (`?vacpDebug=1`).
2. Use **both**:
   - human interaction (brush with the mouse), and
   - agent-like interaction (overlay **Demo** → **Run all**).
3. Read `vacp/ARCHITECTURE.md` (system + protocol spec).
4. Skim the core contract: `packages/lib/core`.
5. Skim the runtime: `packages/lib/gateway` (history, undo/redo, overrides).
6. Skim one provider: `packages/lib/mosaic` or `packages/lib/vega-lite`.
7. Read `packages/vacp-mcp-server/README.md` (agent transport via MCP).

## How it works

VACP has two layers:

1. **Protocol (inside the app)** — TypeScript packages:
   - `@vacp/core`: types (graph, state snapshots, actions)
   - `@vacp/gateway`: runtime bridge + action registry + history (undo/time travel support)
   - `@vacp/kit`: tiny helpers for “bring-your-own-provider” integrations
   - `@vacp/dom`: optional DOM/SVG annotations and embedded SVG metadata
2. **Transport (optional)** — ways to reach the app from an agent:
   - `vacp-mcp-server`: exposes the protocol over MCP by driving a browser via Playwright

MCP is “just a wire”. The protocol lives in the app.

## Where To Read Next

- System + protocol spec: `vacp/ARCHITECTURE.md`
- Runnable demos: `vacp/packages/examples/README.md`
- MCP server: `vacp/packages/vacp-mcp-server/README.md`

## Repository Layout

- `vacp/packages/lib/*`: TypeScript workspace (pnpm)
- `vacp/packages/examples/*`: runnable demos (also serve as regression tests)
- `vacp/packages/vacp-mcp-server`: Python MCP transport (uv)
