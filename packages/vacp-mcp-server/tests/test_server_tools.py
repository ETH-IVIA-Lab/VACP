from __future__ import annotations

import pytest
from fastmcp.tools.tool import FunctionTool

from vacp_mcp_server.bridge import ActionCall, ActionResult, VacpBridgeClient
from vacp_mcp_server.server import create_mcp


class _FakeClient(VacpBridgeClient):
    async def get_capabilities(self) -> dict:
        return {'graph': {'nodes': [], 'edges': [], 'actions': []}}

    async def get_state(self) -> dict:
        return {'state': {}}

    async def execute(self, call: ActionCall) -> ActionResult:
        return ActionResult(
            call_id=call.call_id,
            ok=True,
            result={'name': call.name, 'params': call.params},
            error=None,
        )


@pytest.mark.asyncio
async def test_create_mcp_registers_expected_tools() -> None:
    mcp = create_mcp(_FakeClient())
    tools = await mcp.get_tools()
    assert set(tools.keys()) == {'vacp_capabilities', 'vacp_state', 'vacp_execute'}


@pytest.mark.asyncio
async def test_vacp_execute_tool_calls_surface() -> None:
    mcp = create_mcp(_FakeClient())
    tool = await mcp.get_tool('vacp_execute')
    assert isinstance(tool, FunctionTool)
    res = await tool.fn(name='vacp.data_sql', params={'handleRef': 'vacp://x', 'sql': 'select 1'}, call_id='c1')
    assert res['callId'] == 'c1'
    assert res['ok'] is True
    assert res['result'] == {'name': 'vacp.data_sql', 'params': {'handleRef': 'vacp://x', 'sql': 'select 1'}}
