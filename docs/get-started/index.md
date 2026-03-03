# Get started

This repo includes runnable examples and a debug overlay. You should be able to run the gallery, inspect the semantic graph, and execute actions.

## Install

```bash
pnpm install
pnpm build
uv sync
pnpm --filter @vacp/e2e exec playwright install chromium
uv run playwright install chromium
```

## Run the examples gallery

```bash
pnpm dev
```

Open `http://127.0.0.1:5173/`.

## Enable the debug overlay

Add `?vacp-debug=1` to the URL. For local development you can also set `VACP_DEBUG_UI=1` when starting the dev server.

Interact with a chart and watch the state snapshot change. Then dispatch an action and confirm the interface updates.

## Drive the page via MCP

In another terminal, start the MCP server and point it at the running gallery:

```bash
uv run vacp-mcp-server --url http://127.0.0.1:5173/
```

The MCP transport implementation lives in `packages/lib/transports/mcp-server`. It uses [Model Context Protocol](https://modelcontextprotocol.io/) and [Playwright](https://playwright.dev/).

## Run checks

```bash
pnpm test:e2e
pnpm test:mcp
```

## Develop an example on its own

Use this when you want faster iteration on one app or one provider integration.

```bash
pnpm -C packages/examples/vgplot-gallery dev
pnpm -C packages/examples/vega-lite-gallery dev
pnpm -C packages/examples/cars-parallel-coords dev
pnpm -C packages/examples/react-dashboard dev
```

## Repo layout

The workspace is organized by responsibility.

```text
packages/
  lib/
    protocol/   # contract types and runtime gateway
    providers/  # runtime-specific semantic mappings
    transports/ # MCP server and in-page transport client
    tooling/    # debug overlay and analytics
    evaluation/ # scenario runner and analysis tooling
  testing/
    e2e/        # Playwright end-to-end suite
  examples/
    index/                # static gallery host
    vgplot-gallery/
    vega-lite-gallery/
    cars-parallel-coords/
    react-dashboard/
```
