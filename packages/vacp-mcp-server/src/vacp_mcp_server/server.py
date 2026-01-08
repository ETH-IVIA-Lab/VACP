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
VACP bridge-only MCP server.

This server is a thin adapter over the in-page VACP bridge (typically `window.__vacp`).
The VACP protocol (graph/state/actions) lives inside the app; MCP is only the transport.

Typical agent workflow:
1) Call `vacp_capabilities()` to discover the semantic graph and available actions.
2) Call `vacp_state()` to read current selections/params (keyed by stable `ref` strings).
3) Call `vacp_execute(name, params?, call_id?)` with an action `name` from capabilities.
""".strip(),
    )

    @mcp.tool(
        title='VACP Capabilities Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_capabilities() -> dict[str, object]:
        """
        Fetch the VACP capabilities snapshot from the page's in-window bridge.

        Use this to discover the semantic graph (nodes/edges) and the action catalog:
        - `graph.actions[].name`: stable action id to pass to `vacp_execute`
        - `graph.actions[].parameters`: JSON-schema-like parameter shape
        - `graph.actions[].targetRef` (optional): which node the action applies to

        Returns a JSON object like:
        `{ version, createdAt, graph: { version, nodes, edges, actions } }`.

        Side effects: none (read-only). Fails if the VACP bridge is not installed on the page.
        """
        return await client.get_capabilities()

    @mcp.tool(
        title='VACP State Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_state() -> dict[str, object]:
        """
        Fetch the current VACP state snapshot from the page's in-window bridge.

        This is the "what is currently true?" view of the app's semantic state. The snapshot is
        keyed by stable `ref` strings (not DOM positions), for example selections and parameters.

        Returns a JSON object like:
        `{ version, createdAt, state: { [ref: string]: unknown } }`.

        Side effects: none (read-only). Pair with `vacp_capabilities()` to interpret refs/types.
        """
        return await client.get_state()

    @mcp.tool(
        title='VACP Execute Action',
    )
    async def vacp_execute(
        name: str, params: dict[str, object] | None = None, call_id: str | None = None
    ) -> dict[str, object]:
        """
        Execute a named VACP action via the page's in-window bridge.

        Inputs:
        - `name`: an action id from `vacp_capabilities().graph.actions[].name`
        - `params` (optional): JSON-serializable object matching that action's `parameters` schema
        - `call_id` (optional): correlation id echoed back as `callId` in the result

        Effect:
        - Requests a semantic operation inside the app (no pixel/DOM automation). Actions may
          change the app's state; read the updated state via `vacp_state()` afterwards.

        Returns:
        `{ callId, ok, result?, error? }` where `ok=false` indicates a handled failure and
        `error` is a JSON object (often `{message: string}`).

        Fails if the VACP bridge is not installed on the page.
        """
        call = ActionCall(call_id=call_id or 'call', name=name, params=params)
        res = await client.execute(call)
        return {'callId': res.call_id, 'ok': res.ok, 'result': res.result, 'error': res.error}

    return mcp
