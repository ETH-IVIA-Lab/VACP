"""Playwright client for the in-page VACP bridge."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Protocol

from playwright.async_api import Page

from vacp.agent_tools import AGENT_ACTOR, CapabilitiesRequest, StateRequest
from vacp.provider import VACP_SCHEMA_VERSION, ActionCall, ActionResult

# The members the five agent tools call. A page whose bridge lacks one cannot serve them.
_BRIDGE_CHECK = """
({ key, version }) => {
  const b = globalThis?.[key];
  return !!(b
    && typeof b === 'object'
    && b.version === version
    && ['observe', 'getCapabilities', 'getState', 'execute', 'narrate'].every((m) => typeof b[m] === 'function'));
}
"""


class VacpBridgeClient(Protocol):
    async def observe(self) -> dict[str, object]: ...

    async def get_capabilities(self, request: CapabilitiesRequest | None = None) -> dict[str, object]: ...

    async def get_state(self, request: StateRequest) -> dict[str, object]: ...

    async def execute(self, call: ActionCall, *, narration: str) -> ActionResult: ...

    async def progress(self, message: str, *, done: bool = False) -> None: ...


class PlaywrightVacpBridgeClient(VacpBridgeClient):
    """
    Call the page's `window[global_key]` bridge through the Playwright page `page()` returns. Steps and
    narration share `AGENT_ACTOR`, so they join one presence entry and one turn.
    """

    def __init__(self, page: Callable[[], Page], *, global_key: str = '__vacp'):
        self._page = page
        self._global_key = global_key

    async def _require_bridge(self) -> None:
        if not await self._page().evaluate(_BRIDGE_CHECK, {'key': self._global_key, 'version': VACP_SCHEMA_VERSION}):
            raise RuntimeError(f'No VACP {VACP_SCHEMA_VERSION} bridge that can narrate at window.{self._global_key}')

    async def _read(self, call: str, arg: object) -> Any:
        """Run `call` in the page and read its value as the page's JSON writes it.

        Dates arrive as ISO instants and undefined fields stay out, as they do for TypeScript tools.
        """
        await self._require_bridge()
        text = await self._page().evaluate(f'async (arg) => JSON.stringify(await ({call})(arg))', arg)
        return json.loads(text) if isinstance(text, str) else None

    async def observe(self) -> dict[str, object]:
        return await self._read('(key) => globalThis[key].observe()', self._global_key)

    async def get_capabilities(self, request: CapabilitiesRequest | None = None) -> dict[str, object]:
        return await self._read(
            '({ key, request }) => globalThis[key].getCapabilities(request ?? undefined)',
            {'key': self._global_key, 'request': request},
        )

    async def get_state(self, request: StateRequest) -> dict[str, object]:
        return await self._read(
            '({ key, request }) => globalThis[key].getState(request)', {'key': self._global_key, 'request': request}
        )

    async def execute(self, call: ActionCall, *, narration: str) -> ActionResult:
        """Execute one action. `narration` is the step's own sentence, which the execution carries."""
        payload: dict[str, object] = {'callId': call.call_id, 'name': call.name}
        if call.has_params:
            payload['params'] = call.params
        raw = await self._read(
            '({ key, payload, actor, narration }) => globalThis[key].execute(payload, { actor, narration })',
            {'key': self._global_key, 'payload': payload, 'actor': AGENT_ACTOR, 'narration': narration},
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
        await self._read(
            '({ key, actor, message, done }) => globalThis[key].narrate({ actor, message, done })',
            {'key': self._global_key, 'actor': AGENT_ACTOR, 'message': message, 'done': done},
        )
