from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, Protocol

from fastmcp import FastMCP

from vacp_mcp_server.bridge import ActionCall, VacpBridgeClient
from vacp_mcp_server.models import normalize_capabilities_request_options, normalize_state_request_options

"""
MCP adapter layer (project concepts).

This module maps the in-page VACP bridge (`window.__vacp`) to MCP tools.
The goal is to give agents a deterministic, typed interface that enables a
true human↔AI partnership inside a visual analytics (VA) app:

- vacp_capabilities(): discover nodes + actions
- vacp_state(): read current selections/params
- vacp_execute(): request a semantic action

Agents should satisfy user queries by *interacting with the app* (not by inventing answers
or jumping straight to an imagined SQL query):
- execute a series of human-like semantic operations (brush, toggle, filter, zoom, etc),
- observe how the state graph changes after each operation,
- iterate until the user's question is answered, with the user able to watch and steer.

The contract is `vacp_capabilities()`: read it first, then plan actions around what the app
explicitly exposes. If the needed operation is not available, ask the user for guidance or
for the app to expose the missing capability rather than fabricating data access.

The MCP server is intentionally thin: semantics belong to the app/provider; MCP is transport.
"""

_DEFAULT_READY_TIMEOUT_MS = 60_000


class BrowserPage(Protocol):
    """
    Minimal Playwright Page surface needed by our MCP tools.

    We intentionally depend on a Protocol instead of Playwright's concrete type to:
    - keep the adapter layer testable without launching a real browser,
    - avoid hard-coupling the MCP layer to Playwright imports.
    """

    url: str

    async def goto(self, url: str, *, wait_until: str | None = None) -> Any: ...

    async def title(self) -> str: ...

    async def evaluate(self, expression: str, arg: Any | None = None) -> Any: ...

    async def screenshot(self, *, path: str, full_page: bool = True) -> bytes: ...

    async def wait_for_timeout(self, timeout: float) -> Any: ...

    async def wait_for_selector(
        self, selector: str, *, timeout: float | None = None, state: str | None = None
    ) -> Any: ...

    async def click(self, selector: str) -> Any: ...

    async def fill(self, selector: str, value: str) -> Any: ...

    async def press(self, selector: str, key: str) -> Any: ...


async def _wait_for_bridge_ready(client: VacpBridgeClient, timeout_ms: int) -> None:
    """
    Wait until the in-page VACP bridge is available.
    """
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    last_error: Exception | None = None

    while True:
        try:
            await client.get_capabilities()
            return
        except Exception as e:  # noqa: BLE001
            last_error = e

        if time.monotonic() >= deadline:
            msg = f'Timed out waiting for VACP bridge after {timeout_ms}ms'
            raise RuntimeError(msg) from last_error

        await asyncio.sleep(0.1)


def create_mcp(
    client: VacpBridgeClient,
    *,
    page: BrowserPage | None = None,
    enable_browser_tools: bool = False,
) -> FastMCP:
    mcp = FastMCP(
        'VACP MCP Server',
        instructions="""
VACP bridge-only MCP server.

This server is a thin adapter over the in-page VACP bridge `window.__vacp`.
The VACP protocol (graph/state/actions) lives inside the app; MCP is only the transport.

Use it for interactive visual analytics:
- treat the task as stateful interaction in the app, not memory-based answering,
- plan from `vacp_capabilities()`, act with `vacp_execute()`, verify with `vacp_state()`,
- perform small semantic steps and confirm each step before the next.

Efficient defaults:
1) Call `vacp_capabilities()` once initially (re-read only if needed); use scoped options when the task is localized.
2) Call `vacp_state()` once for baseline.
3) Then prefer `vacp_state(options={mode:"delta", since:"<token>"})`.
4) Add `refs` once target refs are known; set `includeSummary=false` unless needed.
5) If delta lineage is unclear, resync with one `mode:"full"` call.
""".strip(),
    )

    @mcp.tool(
        title='VACP Capabilities Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_capabilities(options: dict[str, object] | None = None) -> dict[str, object]:
        """
        Fetch the VACP capabilities snapshot from the page's in-window bridge.

        Use this as your source of truth for what you are allowed to do in the VA app.
        Read it before you plan actions, and refer back to it whenever you're unsure.
        In most runs, one initial read is enough.

        Use it to discover the semantic graph nodes and edges and the action catalog so you
        can decide which human-like interaction to perform next instead of jumping to an
        imagined direct SQL query:
        - `graph.actions[].name`: stable action id to pass to `vacp_execute`
        - `graph.actions[].parameters`: JSON-schema-like parameter shape
        - `graph.actions[].targetRef`: target node for the action when present

        Optional `options` can scope the graph:
        - `refs` / `prefixes`
        - `kinds` / `layers`
        - `includeActions` / `includeEdges` / `includeNodeData`

        Returns a JSON object like:
        `{ version, createdAt, graph: { version, nodes, edges, actions } }`.

        Side effects: none (read-only). Fails if the VACP bridge is not installed on the page.
        """
        request = normalize_capabilities_request_options(options)
        return await client.get_capabilities(request)

    @mcp.tool(
        title='VACP State Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_state(options: dict[str, object] | None = None) -> dict[str, object]:
        """
        Fetch the current VACP state snapshot (or requested update) from the in-window bridge.

        This is the "what is currently true?" view of the app's semantic state. The snapshot is
        keyed by stable `ref` strings (not DOM positions), for example selections and parameters.

        Use this to:
        - confirm that your last action actually changed the state graph,
        - drive the next step (e.g. pick the right `ref`/category/range),
        - keep the user and agent aligned on what the app currently shows.

        For user questions/requests, prefer bringing the app into a state where the answer is
        apparent/inspectable in the UI. Use `vacp_state()` to narrate what changed and to ensure
        you're not skipping over necessary interaction steps.

        When `options` is omitted, returns a full snapshot:
        `{ version, createdAt, state: { [ref: string]: unknown } }`.

        Optional `options` supports efficient updates:
        - `mode`: `auto` | `full` | `delta`
        - `since`: prior token
        - `refs`: limit to specific refs
        - `includeSummary`: include/exclude summary map

        Recommended usage pattern:
        1) Read full once to establish a token.
        2) After each meaningful action, request `mode=delta` with `since=<last token>`.
        3) Add `refs` when you know which nodes matter.
        4) Keep `includeSummary=false` unless summary fields are needed.
        5) If token lineage is uncertain, refresh once with `mode=full`.

        With `options`, returns an update envelope:
        - `mode=full`: `{ mode, token, snapshot, ... }`
        - `mode=delta`: `{ mode, token, baseToken, delta, ... }`

        Side effects: none (read-only). Pair with `vacp_capabilities()` to interpret refs/types.
        """
        request = normalize_state_request_options(options)
        return await client.get_state(request)

    @mcp.tool(
        title='VACP Execute Action',
    )
    async def vacp_execute(
        name: str,
        params: dict[str, object] | None = None,
        call_id: str | None = None,
    ) -> dict[str, object]:
        """
        Execute a named VACP action via the page's in-window bridge.

        Inputs:
        - `name`: an action id from `vacp_capabilities().graph.actions[].name`
        - `params` (optional): JSON-serializable object matching that action's `parameters` schema
        - `call_id` (optional): correlation id echoed back as `callId` in the result

        Effect:
        - Requests a semantic operation inside the app with no pixel or DOM automation.
          Treat this as a human-like interaction primitive such as brush, toggle, pan/zoom, or reset.
        - Actions may change the app's state; always read the updated state via `vacp_state()`
          afterwards to verify the expected change happened.
        - Prefer one small action per call, then verify state before the next action.
        - Prefer chaining these app actions to reach a UI state that answers the user's question instead
          of fabricating answers or jumping straight to imagined SQL queries.

        Returns:
        `{ callId, ok, result?, error? }` where `ok=false` indicates a handled failure and
        `error` is a JSON object and commonly includes `{message: string}`.

        Fails if the VACP bridge is not installed on the page.
        """
        call = ActionCall(call_id=call_id or 'call', name=name, params=params)
        res = await client.execute(call)
        return {'callId': res.call_id, 'ok': res.ok, 'result': res.result, 'error': res.error}

    if page is not None:

        @mcp.tool(
            title='VACP Open URL',
        )
        async def vacp_open_url(
            url: str,
            wait_for_bridge: bool = True,
            timeout_ms: int = _DEFAULT_READY_TIMEOUT_MS,
        ) -> dict[str, object]:
            """
            Navigate the VACP browser page to a URL.

            Use this at the start of a run to open the scenario URL before calling
            `vacp_capabilities()` / `vacp_state()` / `vacp_execute()`.

            If `wait_for_bridge` is true, the tool waits until the in-page VACP bridge is ready.
            """
            if not isinstance(url, str) or not url.strip():
                raise ValueError('Expected url to be a non-empty string')
            if not isinstance(timeout_ms, int) or timeout_ms < 0 or timeout_ms > 5 * 60_000:
                raise ValueError('Expected timeout_ms to be an int between 0 and 300000')

            await page.goto(url, wait_until='domcontentloaded')
            if wait_for_bridge:
                await _wait_for_bridge_ready(client, timeout_ms)

            return {'url': page.url, 'title': await page.title()}

        @mcp.tool(
            title='VACP Page Info',
            annotations={'readOnlyHint': True},
        )
        async def vacp_page_info() -> dict[str, object]:
            """
            Return basic page metadata for the VACP browser instance.
            """
            return {'url': page.url, 'title': await page.title()}

    if enable_browser_tools and page is not None:

        @mcp.tool(
            title='Browser Screenshot',
        )
        async def browser_screenshot(path: str, full_page: bool = True) -> dict[str, object]:
            """
            Capture a screenshot of the current page.

            The parent directory is created if it doesn't exist.
            """
            if not isinstance(path, str) or not path.strip():
                raise ValueError('Expected path to be a non-empty string')

            out_path = Path(path).expanduser()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(out_path), full_page=bool(full_page))
            return {'ok': True, 'path': str(out_path)}

        @mcp.tool(
            title='Browser Evaluate',
            annotations={'readOnlyHint': True},
        )
        async def browser_eval(expression: str, arg: dict[str, object] | None = None) -> object:
            """
            Evaluate a JavaScript expression in the page context.

            Notes:
            - `expression` can be a JS expression string or an arrow function string.
            - `arg` (optional) is passed as the argument to the evaluated function.
            """
            if not isinstance(expression, str) or not expression.strip():
                raise ValueError('Expected expression to be a non-empty string')
            if len(expression) > 20_000:
                raise ValueError('Expected expression length <= 20000 characters')

            if arg is None:
                return await page.evaluate(expression)
            return await page.evaluate(expression, arg)

        @mcp.tool(
            title='Browser Wait For Selector',
        )
        async def browser_wait_for_selector(
            selector: str, timeout_ms: int = 15_000, state: str | None = None
        ) -> dict[str, object]:
            """
            Wait until a selector is present in the DOM (or matches an optional state).
            """
            if not isinstance(selector, str) or not selector.strip():
                raise ValueError('Expected selector to be a non-empty string')
            if not isinstance(timeout_ms, int) or timeout_ms < 0 or timeout_ms > 120_000:
                raise ValueError('Expected timeout_ms to be an int between 0 and 120000')
            if state is not None and state not in ('attached', 'detached', 'visible', 'hidden'):
                raise ValueError('Expected state to be one of: attached, detached, visible, hidden')

            await page.wait_for_selector(selector, timeout=timeout_ms, state=state)
            return {'ok': True}

        @mcp.tool(
            title='Browser Click',
        )
        async def browser_click(selector: str) -> dict[str, object]:
            """
            Click an element matching a selector.
            """
            if not isinstance(selector, str) or not selector.strip():
                raise ValueError('Expected selector to be a non-empty string')
            await page.click(selector)
            return {'ok': True}

        @mcp.tool(
            title='Browser Fill',
        )
        async def browser_fill(selector: str, value: str) -> dict[str, object]:
            """
            Fill an input/textarea matching a selector with the given value.
            """
            if not isinstance(selector, str) or not selector.strip():
                raise ValueError('Expected selector to be a non-empty string')
            if not isinstance(value, str):
                raise ValueError('Expected value to be a string')
            await page.fill(selector, value)
            return {'ok': True}

        @mcp.tool(
            title='Browser Press',
        )
        async def browser_press(selector: str, key: str) -> dict[str, object]:
            """
            Press a key on an element matching a selector.
            """
            if not isinstance(selector, str) or not selector.strip():
                raise ValueError('Expected selector to be a non-empty string')
            if not isinstance(key, str) or not key.strip():
                raise ValueError('Expected key to be a non-empty string')
            await page.press(selector, key)
            return {'ok': True}

        @mcp.tool(
            title='Browser Sleep',
        )
        async def browser_sleep(ms: int) -> dict[str, object]:
            """
            Sleep for the given duration (milliseconds).
            """
            if not isinstance(ms, int) or ms < 0 or ms > 120_000:
                raise ValueError('Expected ms to be an int between 0 and 120000')
            await page.wait_for_timeout(ms)
            return {'ok': True}

    return mcp
