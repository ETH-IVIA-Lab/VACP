"""FastMCP tools for the in-page VACP bridge."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Annotated, Any, Literal, Protocol
from uuid import uuid4

from fastmcp import FastMCP
from pydantic import MISSING, Field, StringConstraints

from vacp.agent_tools import AGENT_TOOLS, TOOL_GUIDANCE, capabilities_request, state_request, tool_read, tool_result
from vacp.bridge import VacpBridgeClient
from vacp.narration import NARRATION_GUIDANCE, NARRATION_MAX_LENGTH, PROGRESS_FIELDS, parse_narration
from vacp.provider import ActionCall

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


async def wait_for_vacp_bridge(client: VacpBridgeClient, timeout_ms: int) -> None:
    """
    Wait until the in-page VACP bridge answers a capabilities read.
    """
    deadline = time.monotonic() + timeout_ms / 1000
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
type Sentence = Annotated[str, StringConstraints(min_length=1, max_length=NARRATION_MAX_LENGTH)]
type Milliseconds = Annotated[int, Field(ge=0, le=120_000)]


def create_mcp(
    client: VacpBridgeClient,
    *,
    page: Callable[[], BrowserPage] | None = None,
    enable_browser_tools: bool = False,
    lifespan: Callable[[FastMCP[None]], AbstractAsyncContextManager[None]] | None = None,
) -> FastMCP[None]:
    """The agent tools over `client`. With `page`, page tools, and with `enable_browser_tools`, browser control."""
    mcp: FastMCP[None] = FastMCP(
        'VACP MCP Server',
        instructions=(
            'Calls are forwarded to the in-page VACP bridge at `window.__vacp`. The app owns the capability '
            f'graph, state snapshots, and action semantics. {TOOL_GUIDANCE}'
        ),
        lifespan=lifespan,
    )

    @mcp.tool(
        title='VACP Observation',
        description=AGENT_TOOLS['vacp_observe']['description'],
        annotations={'readOnlyHint': True},
    )
    async def vacp_observe() -> dict[str, object]:
        return tool_result(tool_read(await client.observe()))

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
        return tool_result(tool_read(await client.get_capabilities(request)))

    @mcp.tool(
        title='VACP State',
        description=AGENT_TOOLS['vacp_state']['description'],
        annotations={'readOnlyHint': True},
    )
    async def vacp_state(
        since: Name | None = None,
        refs: list[Ref] | None = None,
        includeSummary: bool | None = None,
    ) -> dict[str, object]:
        return tool_result(await client.get_state(state_request(since=since, refs=refs, includeSummary=includeSummary)))

    @mcp.tool(title='VACP Execute Action', description=AGENT_TOOLS['vacp_execute']['description'])
    async def vacp_execute(
        name: Name,
        narration: Annotated[Sentence, Field(description=NARRATION_GUIDANCE)],
        params: object = MISSING,
        call_id: str | None = None,
    ) -> dict[str, object]:
        call_id = call_id or uuid4().hex
        call = ActionCall(call_id, name.strip()) if params is MISSING else ActionCall(call_id, name.strip(), params)
        # The execution carries the step's own sentence, live and in replay.
        res = await client.execute(call, narration=parse_narration(narration))
        # Fields the bridge left out stay out, as the other transports return them.
        return tool_result(
            {
                'callId': res.call_id,
                'ok': res.ok,
                **({'result': res.result} if res.result is not None else {}),
                **({'error': res.error} if res.error is not None else {}),
            }
        )

    @mcp.tool(title='Tell the person what you are doing', description=AGENT_TOOLS['vacp_progress']['description'])
    async def vacp_progress(
        message: Annotated[Sentence, Field(description=PROGRESS_FIELDS['message'])],
        done: Annotated[bool, Field(description=PROGRESS_FIELDS['done'])] = False,
    ) -> dict[str, object]:
        await client.progress(parse_narration(message, field='message'), done=done)
        return {'ok': True}

    if page is None:
        return mcp

    @mcp.tool(title='VACP Open URL')
    async def vacp_open_url(
        url: Name,
        wait_for_bridge: bool = True,
        timeout_ms: Annotated[int, Field(ge=0, le=300_000)] = 60_000,
    ) -> dict[str, object]:
        """
        Navigate the VACP browser page to a URL. With `wait_for_bridge`, wait until the in-page VACP
        bridge answers.
        """
        current = page()
        await current.goto(url, wait_until='domcontentloaded')
        if wait_for_bridge:
            await wait_for_vacp_bridge(client, timeout_ms)
        return {'url': current.url, 'title': await current.title()}

    @mcp.tool(title='VACP Page Info', annotations={'readOnlyHint': True})
    async def vacp_page_info() -> dict[str, object]:
        """
        Return the current VACP browser page URL and title.
        """
        current = page()
        return {'url': current.url, 'title': await current.title()}

    if not enable_browser_tools:
        return mcp

    @mcp.tool(title='Browser Screenshot')
    async def browser_screenshot(path: Name, full_page: bool = True) -> dict[str, object]:
        """
        Capture a screenshot of the current page. Creates the parent directory when it does not exist.
        """
        out_path = Path(path).expanduser()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        await page().screenshot(path=str(out_path), full_page=full_page)
        return {'ok': True, 'path': str(out_path)}

    @mcp.tool(title='Browser Evaluate', annotations={'readOnlyHint': False, 'destructiveHint': True})
    async def browser_eval(
        expression: Annotated[str, StringConstraints(min_length=1, max_length=20_000, pattern=r'.*\S.*')],
        arg: dict[str, object] | None = None,
    ) -> object:
        """
        Evaluate a JavaScript expression in the page context. The expression can change the page.

        - `expression` can be a JS expression string or an arrow function string.
        - `arg` is passed to the evaluated function when provided.
        """
        current = page()
        return tool_result(
            await current.evaluate(expression) if arg is None else await current.evaluate(expression, arg)
        )

    @mcp.tool(title='Browser Wait For Selector')
    async def browser_wait_for_selector(
        selector: Name, timeout_ms: Milliseconds = 15_000, state: BrowserSelectorState | None = None
    ) -> dict[str, object]:
        """
        Wait until a selector reaches the requested Playwright state.
        """
        await page().wait_for_selector(selector, timeout=timeout_ms, state=state)
        return {'ok': True}

    @mcp.tool(title='Browser Click')
    async def browser_click(selector: Name) -> dict[str, object]:
        """
        Click the element matching `selector`.
        """
        await page().click(selector)
        return {'ok': True}

    @mcp.tool(title='Browser Fill')
    async def browser_fill(selector: Name, value: str) -> dict[str, object]:
        """
        Fill the input or textarea matching `selector`.
        """
        await page().fill(selector, value)
        return {'ok': True}

    @mcp.tool(title='Browser Press')
    async def browser_press(selector: Name, key: Name) -> dict[str, object]:
        """
        Press `key` on the element matching `selector`.
        """
        await page().press(selector, key)
        return {'ok': True}

    @mcp.tool(title='Browser Sleep')
    async def browser_sleep(ms: Milliseconds) -> dict[str, object]:
        """
        Wait for `ms` milliseconds.
        """
        await page().wait_for_timeout(ms)
        return {'ok': True}

    return mcp
