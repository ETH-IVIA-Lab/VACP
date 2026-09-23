"""Playwright client for the in-page VACP bridge."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from playwright.async_api import Page

from vacp.models import VacpCapabilitiesRequestOptions, VacpStateRequestOptions

_OMITTED = object()


@dataclass(frozen=True)
class ActionCall:
    call_id: str
    name: str
    params: object = _OMITTED

    @property
    def has_params(self) -> bool:
        """Whether the caller supplied parameters, including an explicit null."""
        return self.params is not _OMITTED


@dataclass(frozen=True)
class ActionResult:
    call_id: str
    ok: bool
    result: object | None = None
    error: dict[str, object] | None = None


class VacpBridgeClient(Protocol):
    async def observe(self) -> dict[str, object]: ...

    async def get_capabilities(self, request: VacpCapabilitiesRequestOptions | None = None) -> dict[str, object]: ...

    async def get_state(self, request: VacpStateRequestOptions | None = None) -> dict[str, object]: ...

    async def execute(self, call: ActionCall) -> ActionResult: ...

    async def progress(self, message: str, *, done: bool = False) -> None: ...


class PlaywrightVacpBridgeClient(VacpBridgeClient):
    """
    Call `window.__vacp` through a Playwright page.
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
                    && typeof b.observe === 'function'
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

    async def observe(self) -> dict[str, object]:
        await self._require_bridge()
        return await self._page.evaluate('(key) => globalThis[key].observe()', self._global_key)

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
        payload: dict[str, object] = {'callId': call.call_id, 'name': call.name}
        if call.has_params:
            payload['params'] = call.params
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

    async def progress(self, message: str, *, done: bool = False) -> None:
        """
        Narrate for the person watching the page through the bridge's public activity channel.

        One activity spans a turn: the first message opens it, later messages replace its text, and
        `done` closes it. The open handle lives on the page under a registry symbol because handles
        cannot cross the Playwright boundary.
        """
        await self._require_bridge()
        await self._page.evaluate(
            """
            ({ key, message, done }) => {
              const bridge = globalThis[key];
              if (typeof bridge.beginAgentActivity !== 'function') return;
              const slot = Symbol.for(`vacp.mcp.progress:${key}`);
              // The same actor as execute(), so narration and actions share one presence entry and record.
              const actor = { id: 'agent', kind: 'agent', label: 'Agent' };
              const open = globalThis[slot];
              if (done) {
                (open ?? bridge.beginAgentActivity({ actor })).end({ summary: message });
                delete globalThis[slot];
                return;
              }
              if (open) open.update(message);
              else globalThis[slot] = bridge.beginAgentActivity({ actor, summary: message });
            }
            """,
            {'key': self._global_key, 'message': message, 'done': done},
        )
