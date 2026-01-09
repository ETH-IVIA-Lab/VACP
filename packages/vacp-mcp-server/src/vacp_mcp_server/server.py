from __future__ import annotations

from fastmcp import FastMCP

from vacp_mcp_server.bridge import ActionCall, VacpBridgeClient

"""
MCP adapter layer (project concepts).

This module maps the in-page VACP bridge (`window.__vacp`) to MCP tools.
The goal is to give agents a deterministic, typed interface that enables a
true human↔AI partnership inside a visual analytics (VA) app:

- vacp_capabilities(): discover nodes + actions
- vacp_state(): read current selections/params
- vacp_execute(): request a semantic action

Agents should satisfy user queries by *interacting with the app*:
- execute a series of human-like semantic operations (brush, toggle, filter, zoom, etc),
- observe how the state graph changes after each operation,
- iterate until the user’s question is answered, with the user able to watch and steer.

The MCP server is intentionally thin: semantics belong to the app/provider; MCP is transport.
"""


def create_mcp(client: VacpBridgeClient) -> FastMCP:
    mcp = FastMCP(
        'VACP MCP Server',
        instructions="""
VACP bridge-only MCP server.

This server is a thin adapter over the in-page VACP bridge (typically `window.__vacp`).
The VACP protocol (graph/state/actions) lives inside the app; MCP is only the transport.

The intended usage is *interactive visual analytics*:
- do not answer from memory or by dumping raw text when the app can be interacted with,
- satisfy the user’s query by performing a *sequence of semantic, human-like operations*
  (brush selections, toggle categories, change parameters, zoom/pan, etc),
- after each operation, re-read `vacp_state()` and/or `vacp_capabilities()` to confirm the
  app’s state graph reflects what just happened.

Typical agent loop:
1) `vacp_capabilities()` → discover the semantic graph + action catalog.
2) `vacp_state()` → read the current state (what’s selected/filtered/parameterized).
3) `vacp_execute(...)` → perform one small semantic operation.
4) `vacp_state()` → verify the expected state change occurred.
5) Repeat until the user’s question is answered (with the user able to watch and steer).
""".strip(),
    )

    @mcp.tool(
        title='VACP Capabilities Snapshot',
        annotations={'readOnlyHint': True},
    )
    async def vacp_capabilities() -> dict[str, object]:
        """
        Fetch the VACP capabilities snapshot from the page's in-window bridge.

        Use this to discover the semantic graph (nodes/edges) and the action catalog so you
        can decide which human-like interaction to perform next:
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

        Use this to:
        - confirm that your last action actually changed the state graph,
        - drive the next step (e.g. pick the right `ref`/category/range),
        - keep the user and agent aligned on what the app currently shows.

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
        - Requests a semantic operation inside the app (no pixel/DOM automation). Treat this as
          a "human-like interaction primitive" (brush, toggle, pan/zoom, reset, etc).
        - Actions may change the app's state; always read the updated state via `vacp_state()`
          afterwards to verify the expected change happened.

        Returns:
        `{ callId, ok, result?, error? }` where `ok=false` indicates a handled failure and
        `error` is a JSON object (often `{message: string}`).

        Fails if the VACP bridge is not installed on the page.
        """
        call = ActionCall(call_id=call_id or 'call', name=name, params=params)
        res = await client.execute(call)
        return {'callId': res.call_id, 'ok': res.ok, 'result': res.result, 'error': res.error}

    return mcp
