"""FastMCP tools for the in-page VACP bridge."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, Literal, Protocol

from fastmcp import FastMCP

from vacp.bridge import ActionCall, VacpBridgeClient
from vacp.models import normalize_capabilities_request_options, normalize_state_request_options

_DEFAULT_READY_TIMEOUT_MS = 60_000
type BrowserWaitUntil = Literal['commit', 'domcontentloaded', 'load', 'networkidle']
type BrowserSelectorState = Literal['attached', 'detached', 'hidden', 'visible']


class BrowserPage(Protocol):
    """
    Playwright page methods used by the MCP tools.
    """

    @property
    def url(self) -> str: ...

    async def goto(self, url: str, *, wait_until: BrowserWaitUntil | None = None) -> Any: ...

    async def title(self) -> str: ...

    async def evaluate(self, expression: str, arg: Any | None = None) -> Any: ...

    async def screenshot(self, *, path: str, full_page: bool = True) -> bytes: ...

    async def wait_for_timeout(self, timeout: float) -> Any: ...

    async def wait_for_selector(
        self, selector: str, *, timeout: float | None = None, state: BrowserSelectorState | None = None
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
VACP MCP server.

Calls are forwarded to the in-page VACP bridge at `window.__vacp`. The app owns
the capability graph, state snapshots, and action semantics.

Workflow:
1) Read `vacp_capabilities()` to discover refs, actions, and parameters.
2) Read `vacp_state()` for the current semantic state.
3) Call `vacp_execute()` with one action from the capabilities snapshot.
4) Read `vacp_state()` again to verify the state change.

Efficient defaults:
1) Call `vacp_capabilities()` once initially. Use scoped options when the task is localized.
2) Call `vacp_state()` once for a baseline.
3) After actions, prefer `vacp_state(options={mode:"delta", since:"<token>"})`.
4) Add `refs` once target refs are known. Set `includeSummary=false` unless summary fields are needed.
5) If delta lineage is unclear, resync with one `mode:"full"` call.
""".strip(),
    )

    @mcp.tool(
        title='VACP Capabilities Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_capabilities(options: dict[str, object] | None = None) -> dict[str, object]:
        """
        Return the VACP capabilities snapshot from `window.__vacp`.

        Use `graph.actions[].name` as the action id for `vacp_execute`.
        Optional `options` can scope the graph:
        - `refs` / `prefixes`
        - `kinds` / `layers`
        - `includeActions` / `includeEdges` / `includeNodeData`

        Returns a JSON object like:
        `{ version, createdAt, graph: { version, nodes, edges, actions } }`.

        Side effects: none. Raises when the VACP bridge is not installed on the page.
        """
        request = normalize_capabilities_request_options(options)
        return await client.get_capabilities(request)

    @mcp.tool(
        title='VACP State Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_state(options: dict[str, object] | None = None) -> dict[str, object]:
        """
        Return the current VACP state snapshot or update from `window.__vacp`.

        State entries are keyed by stable refs, for example selections and
        parameters. Read state after `vacp_execute()` to verify the app accepted
        the requested action.

        When `options` is omitted, returns a full snapshot:
        `{ version, createdAt, state: { [ref: string]: unknown } }`.

        Optional `options` supports efficient updates:
        - `mode`: `auto` | `full` | `delta`
        - `since`: prior token
        - `refs`: limit to specific refs
        - `includeSummary`: include/exclude summary map

        With `options`, returns an update envelope:
        - `mode=full`: `{ mode, token, snapshot, ... }`
        - `mode=delta`: `{ mode, token, baseToken, delta, ... }`

        Side effects: none. Pair with `vacp_capabilities()` to interpret refs and action targets.
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
        Execute a named VACP action through `window.__vacp`.

        Inputs:
        - `name`: an action id from `vacp_capabilities().graph.actions[].name`
        - `params` (optional): JSON-serializable object matching that action's `parameters` schema
        - `call_id` (optional): correlation id echoed back as `callId` in the result

        Each call requests one semantic app operation. Actions may change state,
        so read `vacp_state()` afterwards to verify the result before sending
        the next action.

        Returns:
        `{ callId, ok, result?, error? }` where `ok=false` indicates a handled failure and
        `error` is a JSON object and commonly includes `{message: string}`.

        Raises when the VACP bridge is not installed on the page.
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
            Return the current VACP browser page URL and title.
            """
            return {'url': page.url, 'title': await page.title()}

    if enable_browser_tools and page is not None:

        @mcp.tool(
            title='Browser Screenshot',
        )
        async def browser_screenshot(path: str, full_page: bool = True) -> dict[str, object]:
            """
            Capture a screenshot of the current page.

            Creates the parent directory when it does not exist.
            """
            if not isinstance(path, str) or not path.strip():
                raise ValueError('Expected path to be a non-empty string')

            out_path = Path(path).expanduser()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(out_path), full_page=full_page)
            return {'ok': True, 'path': str(out_path)}

        @mcp.tool(
            title='Browser Evaluate',
            annotations={'readOnlyHint': True},
        )
        async def browser_eval(expression: str, arg: dict[str, object] | None = None) -> object:
            """
            Evaluate a JavaScript expression in the page context.

            - `expression` can be a JS expression string or an arrow function string.
            - `arg` is passed to the evaluated function when provided.
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
            Wait until a selector reaches the requested Playwright state.
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
            Click the element matching `selector`.
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
            Fill the input or textarea matching `selector`.
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
            Press `key` on the element matching `selector`.
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
            Wait for `ms` milliseconds.
            """
            if not isinstance(ms, int) or ms < 0 or ms > 120_000:
                raise ValueError('Expected ms to be an int between 0 and 120000')
            await page.wait_for_timeout(ms)
            return {'ok': True}

    return mcp
