# VACP for Python

Use `vacp` to connect an external agent to a VACP-enabled page through MCP and Playwright.

From the repository root:

```bash
uv sync --package vacp --locked
uv run --package vacp playwright install chromium
uv run --package vacp vacp --url http://127.0.0.1:5173/vgplot/
```

The default MCP endpoint is `http://localhost:8000/mcp`. For stdio transport:

```bash
uv run --package vacp vacp --transport stdio --url http://127.0.0.1:5173/vgplot/
```

`python -m vacp` exposes the same CLI. Run `vacp --help` for browser launch, CDP attachment, viewport, navigation, and optional browser-tool flags.

Python integrations can import `BrowserConfig` and `BrowserManager` from `vacp.browser`, and `PlaywrightVacpBridgeClient` from `vacp.bridge`. The bridge client reads capabilities and state and executes semantic actions. MCP tool construction lives in `vacp.server`.

See [agent connections](../../docs/transports/index.md) and the [tool contract](../../docs/reference/tool-contract.md).

Run `make python-check` from the repository root for Python lint, type checks, and tests. Tool versions and configuration are shared in the root `pyproject.toml`.
