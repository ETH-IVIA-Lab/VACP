from __future__ import annotations

from typing import Literal

from fastmcp import FastMCP

from vacp_mcp_server.diagrams import DiagramOptions, render_diagram
from vacp_mcp_server.surfaces.base import ActionCall, Surface

"""
MCP adapter layer (project concepts).

This module maps the VACP Surface abstraction to MCP tools.
The goal is to give agents a deterministic, typed interface:

- vacp_capabilities(): discover nodes + actions
- vacp_state(): read current selections/params
- vacp_execute(): request a semantic action

The MCP server is intentionally thin: semantics belong to the app/provider.
"""


def create_mcp(surface: Surface) -> FastMCP:
    mcp = FastMCP(
        'VACP MCP Server',
        instructions="""
VACP server exposing:

- capabilities(): discover nodes + actions
- state(): current selection/param state
- execute(): run a named action with parameters
""".strip(),
    )

    @mcp.tool
    async def vacp_capabilities() -> dict:
        return await surface.get_capabilities()

    @mcp.tool
    async def vacp_state() -> dict:
        return await surface.get_state()

    @mcp.tool
    async def vacp_execute(name: str, params: dict | None = None, call_id: str | None = None) -> dict:
        call = ActionCall(call_id=call_id or 'call', name=name, params=params)
        res = await surface.execute(call)
        return {'callId': res.call_id, 'ok': res.ok, 'result': res.result, 'error': res.error}

    @mcp.tool
    async def vacp_diagram(
        include_actions: bool = False,
        include_state_preview: bool = False,
        direction: Literal['LR', 'TB'] = 'LR',
    ) -> str:
        """
        Render the current VACP graph as a diagram for debugging.

        - include_actions: render actions as separate nodes linked to targets.
        - include_state_preview: include compact node state in labels (if available).
        - direction: `LR` or `TB`
        """
        capabilities = await surface.get_capabilities()
        state = await surface.get_state()

        graph = capabilities.get('graph') if isinstance(capabilities, dict) else None
        if not isinstance(graph, dict):
            return 'No graph available (capabilities.graph missing).'

        options = DiagramOptions(
            direction='TB' if direction == 'TB' else 'LR',
            include_actions=include_actions,
            include_state_preview=include_state_preview,
        )
        return render_diagram(
            graph=graph,
            state=state if isinstance(state, dict) else None,
            options=options,
        )

    return mcp
