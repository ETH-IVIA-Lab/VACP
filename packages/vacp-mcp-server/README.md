# vacp-mcp-server

An MCP server that exposes a VACP-enabled web page to an agent via Playwright.

This server is intentionally generic:

- **Preferred path:** call the in-page `window.__vacp` bridge (fast, stable, no DOM scraping).
- **Fallback path:** scan DOM/SVG annotations (`data-vacp-*`, `data-interaction-vacp-*`, SVG `<metadata type="application/vacp+json">`).

MCP is only a transport. The VACP protocol and runtime live inside the app.

## Run

From `vacp/`:

- `uv sync`
- `uv run vacp-mcp-server --url http://localhost:5173/`

MCP endpoint defaults to `http://localhost:8000/mcp`.

## Use an external browser (recommended for interactive dev)

You can attach to an already-running Chromium browser via CDP. This is useful if:

- you want to keep browser state (cookies, localStorage, open tabs),
- you want to attach to a browser you started yourself,
- you want to avoid the server launching its own browser window.

1. Start Chrome/Chromium with remote debugging enabled, for example:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222
```

2. Run the server and connect via CDP:

```bash
uv run vacp-mcp-server \
  --cdp-url http://localhost:9222 \
  --reuse-page-url-contains localhost:5173
```

If no existing tab matches, the server will open a new page and navigate to `--url`.
