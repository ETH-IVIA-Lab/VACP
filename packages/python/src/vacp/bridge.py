"""Playwright client for the in-page VACP bridge."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from playwright.async_api import Page

from vacp.agent_tools import CapabilitiesRequest, StateRequest

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


# Steps and narration share one actor, so they join one presence entry and one turn.
AGENT: dict[str, str] = {'id': 'agent', 'kind': 'agent', 'label': 'Agent'}


class VacpBridgeClient(Protocol):
    async def observe(self) -> dict[str, object]: ...

    async def get_capabilities(self, request: CapabilitiesRequest | None = None) -> dict[str, object]: ...

    async def get_state(self, request: StateRequest | None = None) -> dict[str, object]: ...

    async def execute(self, call: ActionCall, *, narration: str | None = None) -> ActionResult: ...

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

    async def _read(self, call: str, arg: object) -> Any:
        """Run `call` in the page and read its value as the page's JSON writes it.

        Dates arrive as ISO instants and undefined fields stay out, as they do for TypeScript tools.
        """
        text = await self._page.evaluate(f'async (arg) => JSON.stringify(await ({call})(arg))', arg)
        return json.loads(text) if isinstance(text, str) else None

    async def observe(self) -> dict[str, object]:
        await self._require_bridge()
        return await self._read('(key) => globalThis[key].observe()', self._global_key)

    async def get_capabilities(self, request: CapabilitiesRequest | None = None) -> dict[str, object]:
        await self._require_bridge()
        return await self._read(
            '({ key, request }) => (request ? globalThis[key].getCapabilities(request) : '
            'globalThis[key].getCapabilities())',
            {'key': self._global_key, 'request': request},
        )

    async def get_state(self, request: StateRequest | None = None) -> dict[str, object]:
        await self._require_bridge()
        return await self._read(
            '({ key, request }) => request ? globalThis[key].getState(request) : globalThis[key].getState()',
            {'key': self._global_key, 'request': request},
        )

    async def execute(self, call: ActionCall, *, narration: str | None = None) -> ActionResult:
        """Execute one action. `narration` is the step's own sentence, which the execution carries."""
        await self._require_bridge()
        payload: dict[str, object] = {'callId': call.call_id, 'name': call.name}
        if call.has_params:
            payload['params'] = call.params
        raw = await self._read(
            """({ key, payload, actor, narration }) =>
              globalThis[key].execute(payload, narration ? { actor, narration } : undefined)""",
            {'key': self._global_key, 'payload': payload, 'actor': AGENT, 'narration': narration},
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
        Narrate for the person watching through the runtime's narrator. The first sentence opens a
        turn, later ones replace its words, and `done` closes it. The runtime closes a turn left quiet
        once the agent has no step in flight.
        """
        await self._require_bridge()
        await self._page.evaluate(
            """
            ({ key, actor, message, done }) => {
              const bridge = globalThis[key];
              if (typeof bridge.narrate === 'function') bridge.narrate({ actor, message, done });
            }
            """,
            {'key': self._global_key, 'actor': AGENT, 'message': message, 'done': done},
        )
