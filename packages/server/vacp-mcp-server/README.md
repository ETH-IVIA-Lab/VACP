# vacp-mcp-server

An MCP server exposing VACP snapshots (capabilities + state) and executing VACP actions
against a live browser page.

This server is intentionally generic:

- **Preferred path:** calls into an in-page `window.__vacp` bridge (fast, stable).
- **Fallback path:** scans DOM/SVG annotations (`data-vacp-*`, `data-interaction-vacp-*`, SVG `<metadata type="application/vacp+json">`).

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
