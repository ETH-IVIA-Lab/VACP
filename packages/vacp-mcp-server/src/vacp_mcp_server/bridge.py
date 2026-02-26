from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from playwright.async_api import Page

from vacp_mcp_server.models import VacpCapabilitiesRequestOptions, VacpStateRequestOptions

"""
Bridge client (project concepts).

The VACP runtime is exposed by the web app as an in-page bridge at `window.__vacp`.
The MCP server is only a transport/proxy: it forwards calls and returns results.

This module is intentionally small:
- no DOM scanning
- no diagram rendering
- no app-specific semantics
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


class VacpBridgeClient(Protocol):
    async def get_capabilities(self, request: VacpCapabilitiesRequestOptions | None = None) -> dict[str, object]: ...

    async def get_state(self, request: VacpStateRequestOptions | None = None) -> dict[str, object]: ...

    async def execute(self, call: ActionCall) -> ActionResult: ...


class PlaywrightVacpBridgeClient(VacpBridgeClient):
    """
    Bridge client backed by a Playwright Page.
    """

    def __init__(self, page: Page, *, global_key: str = '__vacp'):
        self._page = page
        self._global_key = global_key

    async def _require_bridge(self) -> None:
        ok = bool(
            await self._page.evaluate(
                """
                (key) => {
                  const b = globalThis?.[key];
                  return !!(b
                    && typeof b === 'object'
                    && typeof b.getCapabilities === 'function'
                    && typeof b.getState === 'function'
                    && typeof b.execute === 'function');
                }
                """,
                self._global_key,
            )
        )
        if not ok:
            raise RuntimeError('VACP window bridge not available (expected window.__vacp)')

    async def get_capabilities(self, request: VacpCapabilitiesRequestOptions | None = None) -> dict[str, object]:
        await self._require_bridge()
        if request is None:
            return await self._page.evaluate("""(key) => globalThis[key].getCapabilities()""", self._global_key)
        return await self._page.evaluate(
            """({ key, request }) => globalThis[key].getCapabilities(request)""",
            {'key': self._global_key, 'request': request},
        )

    async def get_state(self, request: VacpStateRequestOptions | None = None) -> dict[str, object]:
        await self._require_bridge()
        if request is None:
            return await self._page.evaluate("""(key) => globalThis[key].getState()""", self._global_key)
        return await self._page.evaluate(
            """({ key, request }) => globalThis[key].getState(request)""",
            {'key': self._global_key, 'request': request},
        )

    async def execute(self, call: ActionCall) -> ActionResult:
        await self._require_bridge()
        payload = {'callId': call.call_id, 'name': call.name, 'params': call.params}
        raw = await self._page.evaluate(
            """({ key, payload }) => globalThis[key].execute(payload)""",
            {'key': self._global_key, 'payload': payload},
        )
        if isinstance(raw, dict) and 'callId' in raw and 'ok' in raw:
            return ActionResult(
                call_id=str(raw.get('callId')),
                ok=bool(raw.get('ok')),
                result=raw.get('result'),
                error=raw.get('error') if isinstance(raw.get('error'), dict) else None,
            )
        return ActionResult(call_id=call.call_id, ok=False, error={'message': 'Invalid execute() response', 'raw': raw})
