# Get started

This repo includes runnable examples and a debug overlay. You should be able to run the gallery, inspect the semantic graph, and execute actions.

## Install

```bash
pnpm install
pnpm build
uv sync
pnpm exec playwright install chromium
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

## Run checks

```bash
pnpm test:examples
pnpm test:server
```

## Develop an example on its own

Use this when you want faster iteration on one app or one provider integration.

```bash
pnpm -C packages/examples/mosaic-gallery dev
pnpm -C packages/examples/vega-lite-gallery dev
pnpm -C packages/examples/cars-parallel-coords dev
pnpm -C packages/examples/react-dashboard dev
```
