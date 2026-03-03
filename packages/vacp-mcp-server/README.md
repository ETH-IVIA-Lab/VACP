# vacp-mcp-server

## Purpose

An MCP server that exposes a VACP-enabled web page to an external agent by driving a browser via Playwright.

This is a transport adapter: it calls the in-page bridge (`window.__vacp`) and returns semantic capabilities/state/action results.

## When to use

- You want to control or observe a VACP-enabled app from outside the browser process.
- You want an MCP tool surface (`vacp_capabilities`, `vacp_state`, `vacp_execute`) instead of DOM automation.

## Conceptual model

- The protocol lives inside the app (`window.__vacp`).
- The MCP server is one transport implementation that forwards the same semantic contract.
- Optional Playwright-backed tools can be enabled for screenshots and DOM-level helpers.

## Minimal usage

From the repo root:

```bash
uv sync
uv run playwright install chromium
uv run vacp-mcp-server --url http://localhost:<vite-port>/
```

Default MCP endpoint: `http://localhost:8000/mcp`.

## Core MCP tools

- `vacp_capabilities(options?)`
- `vacp_state(options?)`
- `vacp_execute(name, params?, call_id?)`
- `vacp_open_url(url, wait_for_bridge?, timeout_ms?)`
- `vacp_page_info()`

## Stdio transport

Some MCP hosts expect stdin/stdout transport:

```bash
uv run vacp-mcp-server --transport stdio --url http://localhost:<vite-port>/
```

Notes:

- In stdio mode, `--host/--port` are ignored.
- Keep stdout clean; logs go to stderr.

## Optional browser tools

Start with:

- `--enable-browser-tools`

This adds Playwright-backed helpers (screenshot/eval/click/fill/press/wait).

## External browser via CDP

You can attach to an already-running Chromium via CDP:

```bash
uv run vacp-mcp-server \
  --cdp-url http://localhost:9222 \
  --reuse-page-url-contains localhost:<vite-port> \
  --url http://localhost:<vite-port>/
```

## Related docs

- [Transports](../../docs/transports/index.md)
- [Tool Contract](../../docs/reference/tool-contract.md)
- [Configuration](../../docs/reference/configuration.md)
