# vacp-mcp-server

An MCP server that exposes a VACP-enabled web page to an agent via Playwright.

This server is intentionally generic:

- Call the in-page `window.__vacp` bridge (fast, stable, no DOM scraping).

MCP is only a transport. The VACP protocol and runtime live inside the app.

## Run

From the repo root:

- `uv sync`
- Install Playwright browser: `uv run playwright install chromium`
- HTTP mode (default): `uv run vacp-mcp-server --url http://localhost:<vite-port>/`

MCP endpoint defaults to `http://localhost:8000/mcp`.

### Stdio MCP mode

Some MCP hosts (e.g. desktop apps) expect MCP servers to speak over stdin/stdout.

Run:

- `uv run vacp-mcp-server --transport stdio --url http://localhost:<vite-port>/`

Notes:

- In stdio mode, `--host/--port` are ignored (there is no HTTP server).
- Keep stdout clean; all logs go to stderr.

## MCP tools

- `vacp_capabilities()` → VACP capabilities snapshot (graph + actions)
- `vacp_state()` → VACP state snapshot (current selections/params)
- `vacp_execute(name, params?, call_id?)` → run a semantic action via the bridge

## External browser via CDP

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
  --reuse-page-url-contains localhost:<vite-port>
```

If no existing tab matches, the server will open a new page and navigate to `--url`.

## Useful flags

- `--global-key __vacp`: choose the bridge global name (must match the app)
- `--url http://localhost:<vite-port>/`: point at the running app you want to expose
- `--headless`: run the embedded browser in headless mode (useful for CI/servers)
- `--screen-width/--screen-height`: in headless mode, also sets the Playwright viewport
