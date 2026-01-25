# VACP

VACP makes an interactive visualization “agent-ready” without pixel-based automation.

It does this by giving the app a small, stable API surface:

- **Capabilities**: what is on the page, and what actions exist?
- **State**: what is currently selected / configured?
- **Actions**: semantic operations (e.g. “set interval selection”), not DOM events.

Agents, humans, and debugging tools all interact with the same contract.

## Core idea

Instead of clicking pixels, an agent calls `window.__vacp.execute({ callId, name, params })` (usually via MCP), and the app runs the _same_ semantic interactions a human would.

## What's in this repo

- **Protocol + runtime (TypeScript)**: the in-app contract and history/time travel support (`packages/lib/*`).
- **Providers (TypeScript)**: first-class integrations for specific visualization stacks:
  - Mosaic/vgplot (`@vacp/vgplot`)
  - Vega-Lite/Vega params (`@vacp/vega-lite`)
  - a “BYO provider” kit (`@vacp/kit`) used by the example apps
- **Transport (Python)**: `vacp-mcp-server` (Playwright + MCP), which lets an agent reach `window.__vacp`.
- **Examples**: runnable example apps that double as smoke tests (`pnpm test:examples`).

## Quick start

From the repo root:

- Install JS deps: `pnpm install`
- Build packages: `pnpm build`
- Install Python env: `uv sync`
- Install Playwright browsers:
  - for web tests: `pnpm exec playwright install chromium`
  - for `vacp-mcp-server` (Python): `uv run playwright install chromium`
- Run web example smoke tests: `pnpm test:examples` (starts each demo and validates bidirectionality)
- Run MCP server tests: `pnpm test:server`

Run an example app:

- `pnpm dev:mosaic`
- `pnpm dev:vega-lite`
- `pnpm dev:cars`
- `pnpm dev:react-dashboard`
- `pnpm dev:examples` (examples hub: one base URL for hosting + evaluation routing)

Enable the in-page overlay:

- Set `VACP_DEBUG_UI=1` when starting the dev server, or add `?vacp-debug=1` to the URL
- Click the “VACP” button to inspect the graph, timeline, playbooks, run DuckDB SQL, and dispatch actions manually
- Use `JSON → Apply state to live app` (opt-in) to apply edited state maps during development

## Configuration

VACP has a few “hyper params” that can be set either via URL params (kebab-case) or env vars.

- Debug overlay:
  - URL: `?vacp-debug=1`
  - env: `VACP_DEBUG_UI=1`
  - localStorage: `vacp:debug=1`
- JS bridge exposure (controls whether `window.__vacp` exists at all):
  - URL: `?expose-bridge=0|1`
  - env: `VACP_EXPOSE_BRIDGE=0|1`
- DOM snapshot injection (for DOM-only agents): injects a JSON `<script id="__vacp_snapshot" type="application/json">…</script>`
  - URL: `?vacp-dom-snapshot=0|1`
  - env: `VACP_DOM_SNAPSHOT=0|1`

Precedence: URL overrides env; env overrides localStorage (where supported); otherwise defaults apply.

Run the MCP server:

- Start an example (above), then in another terminal: `uv run vacp-mcp-server --url http://localhost:<vite-port>/`
- The MCP endpoint defaults to `http://localhost:8000/mcp`

For interactive development, it's often nicer to attach to an existing Chrome via CDP:

- See `packages/vacp-mcp-server/README.md`

## Troubleshooting

- Playwright browser missing: run `pnpm exec playwright install chromium` (JS tests) and `uv run playwright install chromium` (Python server).
- Port already in use: start a different example or pass a different `--url` to `vacp-mcp-server`.

## Suggested exploration path

If you're new to the repo, this is the fastest way to build a correct mental model:

1. Run `packages/examples/mosaic-gallery` and open the overlay (`?vacp-debug=1`).
2. Use **both**:
   - human interaction (brush with the mouse), and
   - agent-like interaction (overlay **Playbook** → **Run all**).
3. Read `ARCHITECTURE.md` (system + protocol spec).
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
   - `@vacp/duckdb`: DuckDB helpers for the `vacp.data_sql` action
   - `@vacp/diagrams`: graph → Mermaid source generation (used by the overlay)
   - `@vacp/debug-ui`: optional in-page overlay (inspects `window.__vacp`)
2. **Transport (optional)** — ways to reach the app from an agent:
   - `vacp-mcp-server`: exposes the protocol over MCP by driving a browser via Playwright

MCP is “just a wire”. The protocol lives in the app.

## Where To Read Next

- System + protocol spec: `ARCHITECTURE.md`
- Runnable examples: `packages/examples/README.md`
- MCP server: `packages/vacp-mcp-server/README.md`
- Contributing: `CONTRIBUTING.md`

## Repository Layout

- `packages/lib/*`: TypeScript workspace (pnpm)
- `packages/examples/*`: runnable example apps (also serve as regression tests)
- `packages/vacp-mcp-server`: Python MCP transport (uv)
