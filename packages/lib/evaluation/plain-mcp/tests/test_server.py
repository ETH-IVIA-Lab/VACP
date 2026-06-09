from __future__ import annotations

from typing import Any, cast

import pytest
from fastmcp.tools.function_tool import FunctionTool
from plain_mcp.registry import USE_CASES
from plain_mcp.server import create_mcp
from plain_mcp.use_cases.global_development import DATA_REF, VIEW_REF, YEAR_REF


class _FakeRuntime:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object] | None]] = []

    def remember(self, key: str, value: object | None) -> None:
        pass

    def recall(self, key: str) -> object | None:
        return None

    async def state(self, request: object | None = None) -> dict[str, object]:  # noqa: ARG002
        return {
            'state': {
                YEAR_REF: {'value': 1990},
                VIEW_REF: {'value': {}},
                DATA_REF: {'selectedMeaning': 'all rows'},
            }
        }

    def state_entry(self, snapshot: dict[str, object], ref: str) -> dict[str, object]:
        state = snapshot.get('state')
        if not isinstance(state, dict):
            return {}
        value = cast(dict[str, object], state).get(ref)
        return cast(dict[str, object], value) if isinstance(value, dict) else {}

    async def execute(self, name: str, params: dict[str, object] | None = None) -> object | None:
        self.calls.append((name, params))
        return {'ok': True}


@pytest.mark.asyncio
async def test_create_mcp_registers_only_selected_use_case_tools() -> None:
    mcp = create_mcp(USE_CASES['UC3'], runtime=cast(Any, _FakeRuntime()))
    tools = await mcp.list_tools()

    assert {tool.name for tool in tools} == {
        'get_athlete_dashboard_state',
        'set_sport_filter',
        'set_gender_filter',
        'brush_scatterplot',
        'sort_table',
        'query_athlete_data',
    }


@pytest.mark.asyncio
async def test_read_only_tools_are_annotated() -> None:
    mcp = create_mcp(USE_CASES['UC1'], runtime=cast(Any, _FakeRuntime()))
    tools = {tool.name: tool for tool in await mcp.list_tools()}

    assert tools['get_bubble_chart_state'].annotations is not None
    assert tools['get_bubble_chart_state'].annotations.readOnlyHint is True
    assert tools['query_gapminder_data'].annotations is not None
    assert tools['query_gapminder_data'].annotations.readOnlyHint is True
    assert tools['set_year'].annotations is None or tools['set_year'].annotations.readOnlyHint is not True


@pytest.mark.asyncio
async def test_tool_function_uses_internal_bridge_action_and_arguments() -> None:
    runtime = _FakeRuntime()
    mcp = create_mcp(USE_CASES['UC1'], runtime=cast(Any, runtime))
    tool = await mcp.get_tool('set_year')
    assert isinstance(tool, FunctionTool)

    result = await tool.fn(year=2000)

    assert result == {
        'status': 'ok',
        'action': 'set_year',
        'state': {'year': 1990, 'zoom': {}, 'hover': None},
        'details': {'year': 2000},
    }
    assert runtime.calls == [('vega_lite.set_param', {'ref': YEAR_REF, 'value': 2000})]


@pytest.mark.asyncio
async def test_tool_input_schema_is_parameterized() -> None:
    mcp = create_mcp(USE_CASES['UC5'], runtime=cast(Any, _FakeRuntime()))
    tool = await mcp.get_tool('brush_axis_range')
    assert isinstance(tool, FunctionTool)

    schema: dict[str, Any] = tool.parameters

    assert set(schema['properties']) == {'dimension', 'min_value', 'max_value'}
    assert schema['properties']['dimension']['enum'] == [
        'MPG',
        'Cylinders',
        'Displacement',
        'Horsepower',
        'Weight',
        'Acceleration',
        'Model',
    ]
    assert schema['required'] == ['dimension', 'min_value', 'max_value']
