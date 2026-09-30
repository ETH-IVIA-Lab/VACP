"""FastMCP tools for the in-page VACP bridge."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Annotated, Any, Literal, Protocol

from fastmcp import FastMCP
from pydantic import Field, StringConstraints
from pydantic.experimental.missing_sentinel import MISSING

from vacp.agent_tools import AGENT_TOOLS, TOOL_GUIDANCE, capabilities_request, state_request, tool_read
from vacp.bridge import ActionCall, VacpBridgeClient
from vacp.narration import NARRATION_GUIDANCE, NARRATION_MAX_LENGTH, parse_narration

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


type Ref = Annotated[str, StringConstraints(pattern=r'^vacp://')]
type Name = Annotated[str, StringConstraints(min_length=1, pattern=r'.*\S.*')]


def create_mcp(
    client: VacpBridgeClient,
    *,
    page: BrowserPage | None = None,
    enable_browser_tools: bool = False,
) -> FastMCP:
    mcp = FastMCP(
        'VACP MCP Server',
        instructions=(
            'Calls are forwarded to the in-page VACP bridge at `window.__vacp`. The app owns the capability '
            f'graph, state snapshots, and action semantics. {TOOL_GUIDANCE}'
        ),
    )

    @mcp.tool(
        title='VACP Observation',
        description=AGENT_TOOLS['vacp_observe']['description'],
        annotations={'readOnlyHint': True},
    )
    async def vacp_observe() -> dict[str, object]:
        return tool_read(await client.observe())

    @mcp.tool(
        title='VACP Capabilities',
        description=AGENT_TOOLS['vacp_capabilities']['description'],
        annotations={'readOnlyHint': True},
    )
    async def vacp_capabilities(
        refs: list[Ref] | None = None,
        prefixes: list[Ref] | None = None,
        kinds: list[Name] | None = None,
        layers: list[Name] | None = None,
        includeActions: bool | None = None,
        includeEdges: bool | None = None,
        includeNodeData: bool | None = None,
    ) -> dict[str, object]:
        request = capabilities_request(
            refs=refs,
            prefixes=prefixes,
            kinds=kinds,
            layers=layers,
            includeActions=includeActions,
            includeEdges=includeEdges,
            includeNodeData=includeNodeData,
        )
        return tool_read(await client.get_capabilities(request))

    @mcp.tool(
        title='VACP State',
        description=AGENT_TOOLS['vacp_state']['description'],
        annotations={'readOnlyHint': True},
    )
    async def vacp_state(
        mode: Literal['auto', 'full', 'delta'] | None = None,
        since: Name | None = None,
        refs: list[Ref] | None = None,
        includeSummary: bool | None = None,
    ) -> dict[str, object]:
        request = state_request(mode=mode, since=since, refs=refs, includeSummary=includeSummary)
        return await client.get_state(request)

    @mcp.tool(title='VACP Execute Action', description=AGENT_TOOLS['vacp_execute']['description'])
    async def vacp_execute(
        name: Name,
        narration: Annotated[str, Field(description=NARRATION_GUIDANCE, max_length=NARRATION_MAX_LENGTH)],
        params: object = MISSING,
        call_id: str | None = None,
    ) -> dict[str, object]:
        call = (
            ActionCall(call_id=call_id or 'call', name=name)
            if params is MISSING
            else ActionCall(call_id=call_id or 'call', name=name, params=params)
        )
        # The execution carries the step's own sentence, live and in replay.
        res = await client.execute(call, narration=parse_narration(narration))
        return {'callId': res.call_id, 'ok': res.ok, 'result': res.result, 'error': res.error}

    @mcp.tool(title='Tell the person what you are doing', description=AGENT_TOOLS['vacp_progress']['description'])
    async def vacp_progress(message: str, done: bool = False) -> dict[str, object]:
        text = parse_narration(message, field='progress')
        await client.progress(text, done=done)
        return {'ok': True}

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
