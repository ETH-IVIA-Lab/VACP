from __future__ import annotations

from fastmcp import FastMCP

from vacp_mcp_server.bridge import ActionCall, VacpBridgeClient

"""
MCP adapter layer (project concepts).

This module maps the in-page VACP bridge (`window.__vacp`) to MCP tools.
The goal is to give agents a deterministic, typed interface:

- vacp_capabilities(): discover nodes + actions
- vacp_state(): read current selections/params
- vacp_execute(): request a semantic action

The MCP server is intentionally thin: semantics belong to the app/provider.
"""


def create_mcp(client: VacpBridgeClient) -> FastMCP:
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
        return await client.get_capabilities()

    @mcp.tool
    async def vacp_state() -> dict:
        return await client.get_state()

    @mcp.tool
    async def vacp_execute(name: str, params: dict | None = None, call_id: str | None = None) -> dict:
        call = ActionCall(call_id=call_id or 'call', name=name, params=params)
        res = await client.execute(call)
        return {'callId': res.call_id, 'ok': res.ok, 'result': res.result, 'error': res.error}

    return mcp
