# vacp (Python)

The `vacp` Python package runs an MCP server that drives a VACP page in a browser, and defines providers and composition for Python analytical systems. It requires Python 3.12 or newer. Install it from a checkout of the repository with uv:

```bash
uv sync --package vacp --extra server
```

| Extra    | Adds                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| `server` | The `vacp` MCP server: [FastMCP](https://gofastmcp.com), Playwright, and their dependencies |
| `http`   | `vacp.http.create_inspection_app` and an ASGI server                                        |

## The vacp command

```bash
uv run --package vacp vacp --url <page> [options]
```

Opens `<page>` in a browser through Playwright and serves the page's runtime as the five [agent tools](./agent-tools). With `--transport http`, the default, the MCP endpoint is `http://<host>:<port>/mcp` and `GET /healthz` answers when the server is up.

| Option                              | Default     | Meaning                                                                                                                                                      |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--url`                             |             | The page to open                                                                                                                                             |
| `--transport`                       | `http`      | `http`, or `stdio` for clients that start the server as a subprocess                                                                                         |
| `--host`                            | `127.0.0.1` | The HTTP interface. `0.0.0.0` accepts other machines, with no authentication                                                                                 |
| `--port`                            | `8000`      | The HTTP port                                                                                                                                                |
| `--headless`                        | off         | Run the browser without a window                                                                                                                             |
| `--browser-type`                    | `chromium`  | `chromium`, `firefox`, or `webkit`                                                                                                                           |
| `--browser-path`                    |             | A browser executable                                                                                                                                         |
| `--window-mode`                     | `default`   | `default`, `maximized`, or `fullscreen`, in Chromium                                                                                                         |
| `--screen-width`, `--screen-height` |             | Screen size hints for sizing the browser window                                                                                                              |
| `--cdp-url`                         |             | Attach to a running Chromium over the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) (CDP), such as `http://localhost:9222` |
| `--auto-attach-cdp`                 | off         | Try CDP endpoints on `--auto-attach-cdp-ports` (9222, 9223) before launching                                                                                 |
| `--reuse-page-url-contains`         |             | With CDP, reuse an open page whose URL contains this text                                                                                                    |
| `--global-key`                      | `__vacp`    | The window global holding the bridge                                                                                                                         |
| `--startup-wait-for-bridge`         | off         | Wait for the bridge before serving tools, up to `--startup-ready-timeout-ms` (30000)                                                                         |
| `--startup-wait-for-selector`       |             | Wait for a selector before serving tools, up to `--startup-selector-timeout-ms` (30000), in `--startup-selector-state` (`visible`)                           |
| `--enable-browser-tools`            | off         | Add screenshot, eval, wait-for-selector, click, fill, press, and sleep tools                                                                                 |
| `--show-banner`, `--mcp-log-level`  |             | FastMCP diagnostics                                                                                                                                          |

The browser tools let a client run arbitrary script and input in the page. Enable them only for clients you trust with the page. `vacp_progress` fails when the page's bridge cannot narrate.

## Providers

```python
from vacp import ActionCall, ProviderComposer, SimpleProvider

composer = ProviderComposer([widget_provider, notebook_provider])
observation = await composer.observe()
result = await composer.execute(ActionCall(call_id='c1', name='threshold.set', params={'value': 42}))
```

A `Provider` has a `source`, `observe()`, `prepare(call, context)`, `subscribe(invalidate)`, and `dispose()`. `prepare` validates the call and returns a `PreparedAction` whose `execute()` runs once. `context.ensure_open()` raises when the composer is disposed, so a provider checks it right before it changes its source. `SimpleProvider(source=..., observe=..., prepare=...)` assembles a provider from functions.

`ProviderComposer` mirrors the TypeScript composition: it checks single ownership of nodes and operations, allows edges across sources, and retries a read when a provider invalidates during it.

| Method                  | Returns                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `observe()`             | The available graph, state, summaries, and freshness                      |
| `inspect()`             | The complete catalog with availability                                    |
| `execute(call)`         | An `ActionResult`, after availability checks before and after preparation |
| `subscribe(invalidate)` | A function that removes the subscription                                  |
| `dispose()`             | Releases subscriptions and disposes providers                             |

Records are frozen dataclasses with the protocol's field names in snake case: `Node`, `Edge`, `ActionDescriptor`, `OperationSemantics`, `GraphFragment`, `Observation`, `Freshness`, `Availability`, `ActionCall`, `ActionResult`. `as_dict(record)` serializes one to the JSON shape TypeScript reads. `Availability(requires=(ref,), unavailable=reason)` follows the [availability rules](../availability/), checked against fixtures shared with TypeScript.

## Inspection endpoint

```python
from vacp.http import create_inspection_app

app = create_inspection_app(composer, title='Analysis', allowed_origins=('https://inspector.example',))
```

Returns a [Starlette](https://www.starlette.io) application for [ASGI](https://asgi.readthedocs.io), the Python web server interface, with `/session`, `/observation`, and `/operations` routes under `/api/vacp`, for [`connectHttpInspectorClient`](./inspector#connecthttpinspectorclient). Every request after `/session` carries the session ID, and a mismatched ID fails. Requires the `http` extra. Authentication belongs to the host.
