from __future__ import annotations

import pytest
from fastmcp.tools.tool import FunctionTool
from pydantic import ValidationError

from vacp_mcp_server.bridge import ActionCall, ActionResult, VacpBridgeClient
from vacp_mcp_server.models import VacpStateRequestOptions
from vacp_mcp_server.server import create_mcp


class _FakeClient(VacpBridgeClient):
    def __init__(self) -> None:
        self.last_state_request: VacpStateRequestOptions | None = None

    async def get_capabilities(self) -> dict:
        return {'graph': {'nodes': [], 'edges': [], 'actions': []}}

    async def get_state(self, request: VacpStateRequestOptions | None = None) -> dict:
        self.last_state_request = request
        if request is None:
            return {'state': {}}
        return {
            'mode': 'delta',
            'token': 'st_next',
            'baseToken': request.get('since'),
            'delta': {'changed': {}, 'removed': []},
        }

    async def execute(self, call: ActionCall) -> ActionResult:
        return ActionResult(
            call_id=call.call_id,
            ok=True,
            result={'name': call.name, 'params': call.params},
            error=None,
        )


class _FakePage:
    def __init__(self) -> None:
        self.url = 'about:blank'

    async def goto(self, url: str, *, wait_until: str | None = None) -> None:  # noqa: ARG002
        self.url = url

    async def title(self) -> str:
        return 'Fake Title'

    async def evaluate(self, expression: str, arg: object | None = None) -> object:
        return {'expression': expression, 'arg': arg}

    async def screenshot(self, *, path: str, full_page: bool = True) -> bytes:  # noqa: ARG002
        return b''

    async def wait_for_timeout(self, timeout: float) -> None:  # noqa: ARG002
        return None

    async def wait_for_selector(self, selector: str, *, timeout: float | None = None, state: str | None = None) -> None:  # noqa: ARG002,E501
        return None

    async def click(self, selector: str) -> None:  # noqa: ARG002
        return None

    async def fill(self, selector: str, value: str) -> None:  # noqa: ARG002
        return None

    async def press(self, selector: str, key: str) -> None:  # noqa: ARG002
        return None


@pytest.mark.asyncio
async def test_create_mcp_registers_expected_tools() -> None:
    mcp = create_mcp(_FakeClient())
    tools = await mcp.get_tools()
    assert set(tools.keys()) == {'vacp_capabilities', 'vacp_state', 'vacp_execute'}


@pytest.mark.asyncio
async def test_vacp_state_full_shape_when_options_omitted() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_state')
    assert isinstance(tool, FunctionTool)
    res = await tool.fn()
    assert res == {'state': {}}
    assert client.last_state_request is None


@pytest.mark.asyncio
async def test_vacp_state_forwards_options_for_delta_requests() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_state')
    assert isinstance(tool, FunctionTool)
    res = await tool.fn(
        options={
            'mode': 'delta',
            'since': 'st_prev',
            'refs': ['vacp://a', 'vacp://b'],
            'includeSummary': False,
        }
    )
    assert res['mode'] == 'delta'
    assert client.last_state_request == {
        'mode': 'delta',
        'since': 'st_prev',
        'refs': ['vacp://a', 'vacp://b'],
        'includeSummary': False,
    }


@pytest.mark.asyncio
async def test_vacp_state_rejects_invalid_options() -> None:
    mcp = create_mcp(_FakeClient())
    tool = await mcp.get_tool('vacp_state')
    assert isinstance(tool, FunctionTool)
    with pytest.raises(ValidationError):
        await tool.fn(options={'bogus': 1})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    'options',
    [
        'nope',
        {'mode': 'nope'},
        {'since': ''},
        {'since': '   '},
        {'refs': 'bad'},
        {'refs': ['ok', '   ']},
        {'includeSummary': 'nope'},
    ],
)
async def test_vacp_state_rejects_invalid_option_values(options: object) -> None:
    mcp = create_mcp(_FakeClient())
    tool = await mcp.get_tool('vacp_state')
    assert isinstance(tool, FunctionTool)
    with pytest.raises(ValidationError):
        await tool.fn(options=options)


@pytest.mark.asyncio
async def test_vacp_execute_tool_calls_surface() -> None:
    mcp = create_mcp(_FakeClient())
    tool = await mcp.get_tool('vacp_execute')
    assert isinstance(tool, FunctionTool)
    res = await tool.fn(name='vacp.data_sql', params={'handleRef': 'vacp://x', 'sql': 'select 1'}, call_id='c1')
    assert res['callId'] == 'c1'
    assert res['ok'] is True
    assert res['result'] == {'name': 'vacp.data_sql', 'params': {'handleRef': 'vacp://x', 'sql': 'select 1'}}


@pytest.mark.asyncio
async def test_create_mcp_registers_page_tools_when_page_provided() -> None:
    mcp = create_mcp(_FakeClient(), page=_FakePage())
    tools = await mcp.get_tools()
    assert set(tools.keys()) == {'vacp_capabilities', 'vacp_state', 'vacp_execute', 'vacp_open_url', 'vacp_page_info'}


@pytest.mark.asyncio
async def test_browser_tools_are_gated_by_enable_flag(tmp_path) -> None:
    mcp = create_mcp(_FakeClient(), page=_FakePage(), enable_browser_tools=True)

    tools = await mcp.get_tools()
    assert 'browser_screenshot' in tools
    assert 'browser_eval' in tools

    screenshot = await mcp.get_tool('browser_screenshot')
    assert isinstance(screenshot, FunctionTool)

    out = tmp_path / 'shots' / 's1.png'
    res = await screenshot.fn(path=str(out), full_page=True)
    assert res == {'ok': True, 'path': str(out)}
