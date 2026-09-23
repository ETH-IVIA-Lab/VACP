from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastmcp.tools.function_tool import FunctionTool
from playwright.async_api import Page
from pydantic import ValidationError
from vacp.bridge import ActionCall, ActionResult, PlaywrightVacpBridgeClient, VacpBridgeClient
from vacp.models import VacpCapabilitiesRequestOptions, VacpStateRequestOptions
from vacp.server import create_mcp


class _FakeClient(VacpBridgeClient):
    def __init__(self) -> None:
        self.last_capabilities_request: VacpCapabilitiesRequestOptions | None = None
        self.last_state_request: VacpStateRequestOptions | None = None
        self.narrated: list[tuple[str, bool]] = []

    async def observe(self) -> dict[str, object]:
        return {'revision': 'test', 'graph': {'nodes': [], 'edges': [], 'actions': []}, 'state': {}}

    async def get_capabilities(self, request: VacpCapabilitiesRequestOptions | None = None) -> dict:
        self.last_capabilities_request = request
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

    async def progress(self, message: str, *, done: bool = False) -> None:
        self.narrated.append((message, done))


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
    tools = await mcp.list_tools()
    assert {tool.name for tool in tools} == {
        'vacp_observe',
        'vacp_capabilities',
        'vacp_state',
        'vacp_execute',
        'vacp_progress',
    }


@pytest.mark.asyncio
async def test_vacp_capabilities_full_shape_when_options_omitted() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_capabilities')
    assert isinstance(tool, FunctionTool)
    res = await tool.fn()
    assert res == {'graph': {'nodes': [], 'edges': [], 'actions': []}}
    assert client.last_capabilities_request is None


@pytest.mark.asyncio
async def test_vacp_capabilities_forwards_scoping_options() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_capabilities')
    assert isinstance(tool, FunctionTool)
    await tool.fn(
        options={
            'prefixes': ['vacp://app/view'],
            'includeNodeData': False,
            'kinds': ['View', 'Visualization'],
        }
    )
    assert client.last_capabilities_request == {
        'prefixes': ['vacp://app/view'],
        'includeNodeData': False,
        'kinds': ['View', 'Visualization'],
    }


@pytest.mark.asyncio
async def test_vacp_capabilities_normalizes_bare_root_scope() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_capabilities')
    assert isinstance(tool, FunctionTool)
    await tool.fn(options={'refs': ['vacp://'], 'prefixes': ['vacp://'], 'includeNodeData': False})
    assert client.last_capabilities_request == {'includeNodeData': False}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    'options',
    [
        {'bogus': 1},
        {'kinds': ['']},
        {'layers': ['']},
        {'refs': ['   ']},
        {'includeNodeData': 'nope'},
    ],
)
async def test_vacp_capabilities_rejects_invalid_options(options: object) -> None:
    mcp = create_mcp(_FakeClient())
    tool = await mcp.get_tool('vacp_capabilities')
    assert isinstance(tool, FunctionTool)
    with pytest.raises(ValidationError):
        await tool.fn(options=options)


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
async def test_vacp_state_normalizes_bare_root_scope() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_state')
    assert isinstance(tool, FunctionTool)
    await tool.fn(options={'mode': 'full', 'refs': ['vacp://'], 'includeSummary': True})
    assert client.last_state_request == {'mode': 'full', 'includeSummary': True}


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
async def test_mcp_execution_preserves_json_values_and_omission_through_the_browser_bridge() -> None:
    page = AsyncMock(spec=Page)
    cases = [{}, {'params': None}, {'params': 'hello'}, {'params': [1, 2]}, {'params': {'value': 3}}]
    payloads: list[object] = []

    def evaluate(_expression: str, argument: str | dict[str, object]) -> object:
        if isinstance(argument, str):
            return True
        payloads.append(argument['payload'])
        return {'callId': 'c1', 'ok': True}

    page.evaluate.side_effect = evaluate
    mcp = create_mcp(PlaywrightVacpBridgeClient(page))
    tool = await mcp.get_tool('vacp_execute')
    assert isinstance(tool, FunctionTool)
    for supplied in cases:
        call = ActionCall(call_id='c1', name='custom.input', **supplied)
        assert call.has_params is ('params' in supplied)
        result = await tool.run({'name': 'custom.input', 'call_id': 'c1', **supplied})
        assert result.is_error is False
        assert payloads[-1] == {'callId': 'c1', 'name': 'custom.input', **supplied}


@pytest.mark.asyncio
async def test_create_mcp_registers_page_tools_when_page_provided() -> None:
    mcp = create_mcp(_FakeClient(), page=_FakePage())
    tools = await mcp.list_tools()
    assert {tool.name for tool in tools} == {
        'vacp_observe',
        'vacp_capabilities',
        'vacp_state',
        'vacp_execute',
        'vacp_progress',
        'vacp_open_url',
        'vacp_page_info',
    }


@pytest.mark.asyncio
async def test_browser_tools_are_gated_by_enable_flag(tmp_path) -> None:
    mcp = create_mcp(_FakeClient(), page=_FakePage(), enable_browser_tools=True)

    tools = await mcp.list_tools()
    tool_names = {tool.name for tool in tools}
    assert 'browser_screenshot' in tool_names
    assert 'browser_eval' in tool_names

    screenshot = await mcp.get_tool('browser_screenshot')
    assert isinstance(screenshot, FunctionTool)

    out = tmp_path / 'shots' / 's1.png'
    res = await screenshot.fn(path=str(out), full_page=True)
    assert res == {'ok': True, 'path': str(out)}


@pytest.mark.asyncio
async def test_observation_tool_preserves_provider_revision_and_state() -> None:
    client = _FakeClient()
    tool = await create_mcp(client).get_tool('vacp_observe')
    assert isinstance(tool, FunctionTool)
    assert await tool.fn() == await client.observe()


@pytest.mark.asyncio
async def test_capabilities_accept_provider_defined_analytical_vocabulary() -> None:
    client = _FakeClient()
    tool = await create_mcp(client).get_tool('vacp_capabilities')
    assert isinstance(tool, FunctionTool)
    options = {'kinds': ['AnalysisOutput'], 'layers': ['AnalysisLayer']}
    await tool.fn(options=options)
    assert client.last_capabilities_request == options


@pytest.mark.asyncio
async def test_vacp_progress_narrates_and_closes_a_turn() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_progress')
    assert isinstance(tool, FunctionTool)
    assert 'one short plain sentence' in (tool.description or '')
    await tool.run({'message': '  Narrowing to sprinters under 25 '})
    await tool.run({'message': 'Sprinters under 25 win most medals.', 'done': True})
    assert client.narrated == [
        ('Narrowing to sprinters under 25', False),
        ('Sprinters under 25 win most medals.', True),
    ]
    with pytest.raises(ValueError, match='requires a message'):
        await tool.run({'message': '   '})


@pytest.mark.asyncio
async def test_browser_bridge_progress_keeps_one_page_side_turn() -> None:
    page = AsyncMock(spec=Page)
    payloads: list[object] = []

    def evaluate(_expression: str, argument: str | dict[str, object]) -> object:
        if isinstance(argument, str):
            return True
        payloads.append(argument)
        return None

    page.evaluate.side_effect = evaluate
    client = PlaywrightVacpBridgeClient(page)
    await client.progress('Looking at the age spread')
    await client.progress('Done.', done=True)
    assert payloads == [
        {'key': '__vacp', 'message': 'Looking at the age spread', 'done': False},
        {'key': '__vacp', 'message': 'Done.', 'done': True},
    ]
    expression = page.evaluate.call_args_list[-1].args[0]
    assert 'beginAgentActivity' in expression and 'Symbol.for' in expression
