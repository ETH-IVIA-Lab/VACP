from __future__ import annotations

from typing import Any

from fastmcp import FastMCP

from plain_mcp.protocol import UseCaseSpec
from plain_mcp.runtime import PlainMcpRuntime


def create_mcp(
    use_case: UseCaseSpec,
    *,
    page: Any | None = None,
    runtime: PlainMcpRuntime | None = None,
    global_key: str = '__vacp',
) -> FastMCP:
    if runtime is None:
        if page is None:
            raise ValueError('Expected either page or runtime')
        runtime = PlainMcpRuntime(page, global_key=global_key)
    mcp = FastMCP(
        f'Visual Analytics Actions: {use_case.id}',
        instructions=f"""
Interact with the {use_case.title} visual analytics application through semantic actions.

Use state tools to inspect the current view, action tools to change selections
and filters, and query tools to retrieve data evidence. Answer the user's
question from observed state, interaction results, and returned rows.
""".strip(),
    )

    for spec in use_case.tools:
        annotations: dict[str, object] | None = {'readOnlyHint': True} if spec.read_only else None
        mcp.tool(
            spec.factory(runtime),
            name=spec.name,
            title=spec.title,
            description=spec.description,
            annotations=annotations,
            run_in_thread=False,
        )

    return mcp
