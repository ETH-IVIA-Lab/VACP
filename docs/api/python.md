# vacp (Python)

The `vacp` Python package runs a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets external agents drive a VACP page in a browser, and defines providers and composition for Python analytical systems. It supports Python 3.10 through 3.14.

Run the server with [uv](https://docs.astral.sh/uv/), the Python package manager. The first command installs the Chromium that [Playwright](https://playwright.dev/python/), a browser automation library, drives. The second is the command an MCP client runs to start the server and talk to it over stdio:

```bash
uvx --from 'vacp[server]' playwright install chromium
uvx --from 'vacp[server]' vacp --url http://localhost:5173/
```

To use providers from your own Python code, run `uv add vacp`. These extras add optional features:

- `server` adds the `vacp` command, with [FastMCP](https://gofastmcp.com), a Python MCP framework, and Playwright.
- `http` adds `vacp.http.create_inspection_app` and an ASGI server.

## The vacp command

```bash
vacp --url <page> [options]
```

Opens `<page>` in a browser through Playwright, waits for the page bridge, and serves the page's runtime over stdio as the five [agent tools](./agent-tools), plus `vacp_open_url` to navigate the page and `vacp_page_info` to read its URL and title. With `--transport http`, the MCP endpoint is `http://<host>:<port>/mcp` and `GET /healthz` answers when the server is up. `vacp_progress` fails when the page's bridge cannot narrate.

`vacp_open_url` takes `url`, `waitForBridge` (default `true`), and `timeoutMs` (default `60000`).

- `--url` is the page to open. Defaults to `http://localhost:5173/`.
- `--transport` is `stdio`, for clients that start the server as a subprocess, or `http`. Defaults to `stdio`.
- `--host` is the interface for `--transport http`. Defaults to `127.0.0.1`. `0.0.0.0` accepts other machines, and the server has no authentication.
- `--port` is the port for `--transport http`. Defaults to `8000`.
- `--headless` runs the browser without a window. Off by default.
- `--browser-type` is `chromium`, `firefox`, or `webkit`. Defaults to `chromium`.
- `--browser-path` is a browser executable.
- `--window-mode` is `default`, `maximized`, or `fullscreen`. `maximized` and `fullscreen` apply to Chromium. Defaults to `default`.
- `--screen-width` and `--screen-height` are screen size hints for sizing the browser window.
- `--cdp-url` attaches to a running Chromium over the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) (CDP), such as `http://localhost:9222`.
- `--auto-attach-cdp` tries CDP endpoints before launching a browser. Off by default.
- `--auto-attach-cdp-ports` is the comma-separated list of ports to try. Defaults to `9222,9223`.
- `--reuse-page-url-contains` reuses an open page whose URL contains this text, with `--cdp-url`.
- `--global-key` is the window global that holds the page bridge. Defaults to `__vacp`.
- `--startup-wait-for-bridge` waits for the bridge before serving tools. On by default, and `--no-startup-wait-for-bridge` turns it off. When the wait times out, the server logs it and serves the tools, which report the missing bridge until the page loads.
- `--startup-ready-timeout-ms` bounds that wait. Defaults to `30000`.
- `--startup-wait-for-selector` waits for a selector before serving tools.
- `--startup-selector-timeout-ms` bounds that wait. Defaults to `30000`.
- `--startup-selector-state` is `attached`, `detached`, `visible`, or `hidden`. Defaults to `visible`.
- `--enable-browser-tools` adds screenshot, eval, wait-for-selector, click, fill, press, and sleep tools. Their inputs are camelCase, such as `fullPage` and `timeoutMs`. Off by default. These tools let a client run arbitrary script and input in the page, so enable them for clients you trust with the page.
- `--show-banner` prints the FastMCP banner to stderr.
- `--mcp-log-level` overrides the FastMCP log level in stdio mode.
- `--version` prints the package version.

## Providers

A `Provider` has a `source`, `observe()`, `prepare(call, context)`, `subscribe(invalidate)`, and `dispose()`. `SimpleProvider` assembles one from functions:

```python
import asyncio

from vacp import (
    ActionDescriptor,
    ActionRequest,
    ActionResult,
    GraphFragment,
    OperationSemantics,
    PreparedAction,
    Runtime,
    ProviderObservation,
    SimpleProvider,
    SourceDescription,
)

threshold = {'value': 10.0}
action = ActionDescriptor('threshold.set', 'Set the threshold.', OperationSemantics('mutation'))


def observe():
    graph = GraphFragment(nodes=(), edges=(), actions=(action,))
    return ProviderObservation(str(threshold['value']), '2026-01-01T00:00:00Z', graph, state={})


def prepare(call, context):
    value = float(call.params['value'])

    def run():
        context.ensure_open()
        threshold['value'] = value
        return ActionResult(call.call_id, True, {'value': value})

    return PreparedAction(run)


source = SourceDescription('vacp-source://app/threshold', 'custom', 'Threshold')
runtime = Runtime([SimpleProvider(source=source, observe=observe, prepare=prepare)])
print(asyncio.run(runtime.execute(ActionRequest('threshold.set', {'value': 42}))).ok)  # True
```

`prepare` validates the call and returns a `PreparedAction` whose `execute()` runs once. `context.ensure_open()` raises when the runtime is disposed, so a provider calls it right before it changes its source.

## Runtime

```python
Runtime(providers: Sequence[Provider])
```

Composes providers as the [TypeScript runtime](./runtime) does. It checks that each node and action has one owner, allows edges across sources, and retries a read when a provider invalidates during it. Throws `ValueError` on a duplicate source ID.

- `await observe()` returns the available graph, state, summaries, and freshness.
- `await inspect()` returns the complete catalog with availability.
- `await execute(request)` returns an `ActionResult`, after availability checks before and after preparation.
- `subscribe(invalidate)` returns a function that removes the subscription.
- `dispose()` releases subscriptions and disposes providers.

`execute` assigns a `call_id` when the `ActionRequest`'s is `None` or blank and keeps any other as written, by the same rule as the TypeScript runtime. The result carries it.

## Records

Records are frozen dataclasses with the protocol's field names in snake case: `Node`, `Edge`, `SourceDescription`, `ActionDescriptor`, `OperationSemantics`, `OperationResultDescriptor`, `RefParameter`, `GraphFragment`, `ProviderObservation`, `Observation`, `Freshness`, `Availability`, `ActionRequest`, `ActionCall`, and `ActionResult`.

`as_dict(observation)` serializes a composed `Observation` to the JSON shape TypeScript reads. `Availability(requires=(ref,), unavailable=reason)` follows the [availability rules](../availability/), and `resolve_availability(graph)` applies them.

## create_inspection_app

```python
create_inspection_app(session, *, title='Analysis', allowed_origins=())
```

Returns a [Starlette](https://www.starlette.io) application for [ASGI](https://asgi.readthedocs.io), the Python web server interface, that serves an [inspector](./inspector#connecthttpinspectorclient). Import it from `vacp.http` and install the `http` extra with `uv add 'vacp[http]'`.

```python
from vacp.http import create_inspection_app

app = create_inspection_app(runtime, title='Analysis', allowed_origins=('https://inspector.example',))
```

- `session` has `session_id`, `inspect()`, and `execute(request)`. A `Runtime` qualifies.
- `title` is the name the session reports. Defaults to `'Analysis'`.
- `allowed_origins` lists the origins that may call the routes from a browser. Defaults to `()`, which adds no cross-origin headers.

The routes are `GET /api/vacp/session`, `GET /api/vacp/observation`, and `POST /api/vacp/operations`. The last two require the `X-VACP-Session` header and answer 409 when its value differs from the session ID. Your host supplies authentication.
