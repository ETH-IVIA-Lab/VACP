from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastmcp.exceptions import ValidationError as ToolInputError
from fastmcp.tools.function_tool import FunctionTool
from playwright.async_api import Page
from vacp.agent_tools import (
    AGENT_TOOLS,
    TOOL_GUIDANCE,
    CapabilitiesRequest,
    StateRequest,
    capabilities_request,
    state_request,
    tool_read,
)
from vacp.bridge import AGENT, ActionCall, ActionResult, PlaywrightVacpBridgeClient, VacpBridgeClient
from vacp.narration import NARRATION_GUIDANCE, NARRATION_MAX_LENGTH, PROGRESS_FIELDS, PROGRESS_GUIDANCE, parse_narration
from vacp.server import create_mcp


class _FakeClient(VacpBridgeClient):
    def __init__(self) -> None:
        self.last_capabilities_request: CapabilitiesRequest | None = None
        self.last_state_request: StateRequest | None = None
        self.narrated: list[tuple[str, bool]] = []
        self.messages: list[str | None] = []

    async def observe(self) -> dict[str, object]:
        return {
            'revision': 'test',
            'graph': {
                'nodes': [{'ref': 'vacp://app/chart'}],
                'edges': [],
                'actions': [{'name': 'chart.set'}],
                'ownership': {'nodes': {'vacp://app/chart': 'vacp-source://app'}, 'actions': {}},
            },
            'state': {'vacp://app/chart': {'value': 1}},
        }

    async def get_capabilities(self, request: CapabilitiesRequest | None = None) -> dict:
        self.last_capabilities_request = request
        return {'graph': {'nodes': [], 'edges': [], 'actions': []}}

    async def get_state(self, request: StateRequest | None = None) -> dict:
        self.last_state_request = request
        if request is None:
            return {'state': {}}
        return {
            'mode': 'delta',
            'token': 'st_next',
            'baseToken': request.get('since'),
            'delta': {'changed': {}, 'removed': []},
        }

    async def execute(self, call: ActionCall, *, narration: str | None = None) -> ActionResult:
        self.messages.append(narration)
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


async def _run(client: _FakeClient, name: str, arguments: dict[str, object]) -> object:
    tool = await create_mcp(client).get_tool(name)
    assert isinstance(tool, FunctionTool)
    return (await tool.run(arguments)).structured_content


@pytest.mark.asyncio
async def test_an_unscoped_capabilities_read_leaves_out_node_data() -> None:
    client = _FakeClient()
    assert await _run(client, 'vacp_capabilities', {}) == {'graph': {'nodes': [], 'edges': [], 'actions': []}}
    assert client.last_capabilities_request == {'includeNodeData': False}


@pytest.mark.asyncio
async def test_vacp_capabilities_forwards_scoping_fields() -> None:
    client = _FakeClient()
    await _run(
        client,
        'vacp_capabilities',
        {'prefixes': ['vacp://app/view'], 'includeNodeData': False, 'kinds': ['View', 'Visualization']},
    )
    assert client.last_capabilities_request == {
        'prefixes': ['vacp://app/view'],
        'kinds': ['View', 'Visualization'],
        'includeNodeData': False,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    'arguments',
    [
        {'bogus': 1},
        {'kinds': ['']},
        {'layers': ['']},
        {'refs': ['   ']},
        {'refs': ['app/chart']},
        {'includeNodeData': 'nope'},
    ],
)
async def test_vacp_capabilities_rejects_invalid_fields(arguments: dict[str, object]) -> None:
    with pytest.raises(ToolInputError):
        await _run(_FakeClient(), 'vacp_capabilities', arguments)


@pytest.mark.asyncio
async def test_vacp_state_without_input_reads_the_full_snapshot() -> None:
    client = _FakeClient()
    assert await _run(client, 'vacp_state', {}) == {'state': {}}
    assert client.last_state_request is None


@pytest.mark.asyncio
async def test_vacp_state_forwards_fields_for_delta_requests() -> None:
    client = _FakeClient()
    arguments: dict[str, object] = {
        'mode': 'delta',
        'since': 'st_prev',
        'refs': ['vacp://a', 'vacp://b'],
        'includeSummary': False,
    }
    result = await _run(client, 'vacp_state', arguments)
    assert isinstance(result, dict)
    assert result['mode'] == 'delta'
    assert client.last_state_request == arguments


@pytest.mark.asyncio
@pytest.mark.parametrize(
    'arguments',
    [
        {'bogus': 1},
        {'mode': 'nope'},
        {'since': ''},
        {'since': '   '},
        {'refs': 'bad'},
        {'refs': ['vacp://a', '   ']},
        {'includeSummary': 'nope'},
    ],
)
async def test_vacp_state_rejects_invalid_fields(arguments: dict[str, object]) -> None:
    with pytest.raises(ToolInputError):
        await _run(_FakeClient(), 'vacp_state', arguments)


@pytest.mark.asyncio
async def test_vacp_execute_tool_calls_surface() -> None:
    res = await _run(
        _FakeClient(),
        'vacp_execute',
        {
            'name': 'vacp.data_sql',
            'narration': 'Counting the rows in view.',
            'params': {'handleRef': 'vacp://x', 'sql': 'select 1'},
            'call_id': 'c1',
        },
    )
    assert res == {
        'callId': 'c1',
        'ok': True,
        'result': {'name': 'vacp.data_sql', 'params': {'handleRef': 'vacp://x', 'sql': 'select 1'}},
    }


@pytest.mark.asyncio
async def test_mcp_execution_preserves_json_values_and_omission_through_the_browser_bridge() -> None:
    page = AsyncMock(spec=Page)
    cases = [{}, {'params': None}, {'params': 'hello'}, {'params': [1, 2]}, {'params': {'value': 3}}]
    payloads: list[object] = []

    def evaluate(_expression: str, argument: str | dict[str, object]) -> object:
        if isinstance(argument, str):
            return True
        payloads.append(argument['payload'])
        assert argument['narration'] == 'Reading the input.'
        return {'callId': 'c1', 'ok': True}

    page.evaluate.side_effect = evaluate
    mcp = create_mcp(PlaywrightVacpBridgeClient(page))
    tool = await mcp.get_tool('vacp_execute')
    assert isinstance(tool, FunctionTool)
    for supplied in cases:
        call = ActionCall(call_id='c1', name='custom.input', **supplied)
        assert call.has_params is ('params' in supplied)
        arguments = {'name': 'custom.input', 'narration': 'Reading the input.', 'call_id': 'c1', **supplied}
        result = await tool.run(arguments)
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
async def test_observation_tool_keeps_revision_state_and_actions_and_leaves_out_ownership() -> None:
    client = _FakeClient()
    tool = await create_mcp(client).get_tool('vacp_observe')
    assert isinstance(tool, FunctionTool)
    assert await tool.fn() == {
        'revision': 'test',
        'graph': {'nodes': [{'ref': 'vacp://app/chart'}], 'edges': [], 'actions': [{'name': 'chart.set'}]},
        'state': {'vacp://app/chart': {'value': 1}},
    }


@pytest.mark.asyncio
async def test_capabilities_accept_provider_defined_analytical_vocabulary() -> None:
    client = _FakeClient()
    await _run(client, 'vacp_capabilities', {'kinds': ['AnalysisOutput'], 'layers': ['AnalysisLayer']})
    assert client.last_capabilities_request == {'kinds': ['AnalysisOutput'], 'layers': ['AnalysisLayer']}


@pytest.mark.asyncio
async def test_vacp_progress_narrates_and_closes_a_turn() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_progress')
    assert isinstance(tool, FunctionTool)
    assert tool.description == PROGRESS_GUIDANCE
    await tool.run({'message': '  Narrowing to sprinters under 25 '})
    await tool.run({'message': 'Sprinters under 25 win most medals.', 'done': True})
    assert client.narrated == [
        ('Narrowing to sprinters under 25', False),
        ('Sprinters under 25 win most medals.', True),
    ]
    with pytest.raises(ValueError, match='requires a sentence'):
        await tool.run({'message': '   '})


@pytest.mark.asyncio
async def test_browser_bridge_progress_speaks_through_the_runtime_narrator() -> None:
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
        {'key': '__vacp', 'actor': AGENT, 'message': 'Looking at the age spread', 'done': False},
        {'key': '__vacp', 'actor': AGENT, 'message': 'Done.', 'done': True},
    ]
    expression = page.evaluate.call_args_list[-1].args[0]
    assert 'bridge.narrate' in expression


FIXTURE = json.loads((Path(__file__).parents[2] / 'protocol/test/fixtures/narration.json').read_text())


def test_narration_contract_matches_every_transport() -> None:
    assert FIXTURE['progress'] == PROGRESS_GUIDANCE
    assert FIXTURE['progressFields'] == PROGRESS_FIELDS
    assert FIXTURE['narration'] == NARRATION_GUIDANCE
    assert FIXTURE['maxLength'] == NARRATION_MAX_LENGTH


@pytest.mark.parametrize('case', FIXTURE['cases'])
def test_narration_parses_like_every_transport(case: dict[str, object]) -> None:
    if 'error' in case:
        with pytest.raises((TypeError, ValueError), match=str(case['error'])):
            parse_narration(case['input'])
    else:
        assert parse_narration(case['input']) == case['expected']


@pytest.mark.asyncio
async def test_every_execute_step_carries_its_own_sentence() -> None:
    client = _FakeClient()
    mcp = create_mcp(client)
    tool = await mcp.get_tool('vacp_execute')
    assert isinstance(tool, FunctionTool)
    narration = tool.parameters['properties']['narration']
    assert narration['description'] == NARRATION_GUIDANCE
    assert 'narration' in tool.parameters['required']
    first = {'name': 'cohort.set_sex', 'narration': ' Keeping only female athletes. ', 'params': {'sex': 'female'}}
    await tool.run(first)
    await tool.run({'name': 'cohort.set_sports', 'narration': 'Comparing swimmers with gymnasts.'})
    assert client.narrated == []
    assert client.messages == ['Keeping only female athletes.', 'Comparing swimmers with gymnasts.']
    with pytest.raises(ValueError, match='requires a sentence'):
        await tool.run({'name': 'cohort.set_sex', 'narration': '   '})


PROTOCOL_FIXTURES = Path(__file__).parents[2] / 'protocol/test/fixtures'
AGENT_TOOLS_FIXTURE = json.loads((PROTOCOL_FIXTURES / 'agent-tools.json').read_text())


@pytest.mark.asyncio
async def test_mcp_tools_match_the_agent_tools_of_every_transport() -> None:
    assert AGENT_TOOLS_FIXTURE['tools'] == AGENT_TOOLS
    assert AGENT_TOOLS_FIXTURE['guidance'] == TOOL_GUIDANCE
    mcp = create_mcp(_FakeClient())
    assert TOOL_GUIDANCE in (mcp.instructions or '')
    tools = {tool.name: tool for tool in await mcp.list_tools()}
    assert set(tools) == set(AGENT_TOOLS)
    for name, contract in AGENT_TOOLS.items():
        assert tools[name].description == contract['description']
        assert set(tools[name].parameters.get('properties', {})) == set(contract['input'])


@pytest.mark.parametrize('case', AGENT_TOOLS_FIXTURE['capabilities'])
def test_capabilities_requests_match_every_transport(case: dict[str, Any]) -> None:
    assert capabilities_request(**case['input']) == case['expected']


@pytest.mark.parametrize('case', AGENT_TOOLS_FIXTURE['state'])
def test_state_requests_match_every_transport(case: dict[str, Any]) -> None:
    assert state_request(**case['input']) == case['expected']


def test_graph_reads_match_every_transport() -> None:
    fixture = json.loads((PROTOCOL_FIXTURES / 'tool-read.json').read_text())
    assert tool_read(fixture['read']) == fixture['expected']
