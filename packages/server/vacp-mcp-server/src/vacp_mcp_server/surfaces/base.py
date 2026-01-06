from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

"""
Surface abstraction (project concepts).

The MCP server interacts with a running VA application through a Surface.
A Surface is intentionally small and stable:

- get_capabilities(): discover nodes + actions
- get_state(): read current selections/params
- execute(): request a semantic action

Why this abstraction exists:

- We want the MCP server to be app-agnostic.
- Different apps expose VACP in different ways:
  - preferred: an in-page window bridge (stable, fast, semantic)
  - fallback: DOM/SVG annotations (inspectable, but slower and less stable)
- Future integrations can add new Surfaces (Selenium, remote CDP, native apps).
"""


@dataclass(frozen=True)
class ActionCall:
    call_id: str
    name: str
    params: object | None = None


@dataclass(frozen=True)
class ActionResult:
    call_id: str
    ok: bool
    result: object | None = None
    error: dict[str, object] | None = None


class Surface(Protocol):
    async def get_capabilities(self) -> dict[str, object]: ...

    async def get_state(self) -> dict[str, object]: ...

    async def execute(self, call: ActionCall) -> ActionResult: ...
