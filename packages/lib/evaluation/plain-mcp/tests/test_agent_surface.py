from __future__ import annotations

from typing import Any, cast

import pytest
from plain_mcp.protocol import UseCaseSpec
from plain_mcp.registry import USE_CASES
from plain_mcp.server import create_mcp


@pytest.mark.asyncio
@pytest.mark.parametrize('use_case', tuple(USE_CASES.values()), ids=tuple(USE_CASES))
async def test_agent_surface_registers_only_selected_use_case_tools(use_case: UseCaseSpec) -> None:
    mcp = create_mcp(use_case, runtime=cast(Any, object()))

    tools = await mcp.list_tools()

    assert {tool.name for tool in tools} == {tool.name for tool in use_case.tools}


@pytest.mark.asyncio
@pytest.mark.parametrize('use_case', tuple(USE_CASES.values()), ids=tuple(USE_CASES))
async def test_agent_visible_metadata_uses_semantic_tool_language(use_case: UseCaseSpec) -> None:
    mcp = create_mcp(use_case, runtime=cast(Any, object()))

    tools = await mcp.list_tools()
    instructions = mcp.instructions or ''
    visible_text = '\n'.join(
        [mcp.name, instructions]
        + [str(field) for tool in tools for field in (tool.name, tool.title, tool.description) if field is not None]
    )

    assert 'visual analytics application' in instructions
    assert 'semantic actions' in instructions
    assert 'data evidence' in instructions
    assert mcp.name.startswith('Visual Analytics Actions:')
    for hidden_term in ('VACP', 'vacp_', '__vacp', 'evaluation', 'ablation', 'agent-facing', 'MCP'):
        assert hidden_term not in visible_text
