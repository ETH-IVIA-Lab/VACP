from __future__ import annotations

import json

from playwright.async_api import Page

from vacp_mcp_server.surfaces.base import ActionCall, ActionResult, Surface


class PlaywrightBridgeSurface(Surface):
    """
    Surface backed by an in-page `window.__vacp` bridge.

    This is the preferred path for Mosaic/vgplot integrations: it avoids DOM scans
    and returns stable, canonical snapshots.

    Conceptually:
    - The app owns semantics and publishes a canonical contract (graph/actions/state).
    - The MCP server is a thin transport/proxy for agents, not a re-implementation
      of app logic.
    """

    def __init__(self, page: Page, *, global_key: str = '__vacp'):
        self._page = page
        self._global_key = global_key

    async def _has_bridge(self) -> bool:
        return bool(
            await self._page.evaluate(
                """
                (key) => {
                  const b = globalThis?.[key];
                  const ok = b
                    && typeof b === 'object'
                    && typeof b.getCapabilities === 'function'
                    && typeof b.execute === 'function';
                  return !!ok;
                }
                """,
                self._global_key,
            )
        )

    async def get_capabilities(self) -> dict[str, object]:
        if not await self._has_bridge():
            raise RuntimeError('VACP window bridge not available')
        return await self._page.evaluate("""(key) => globalThis[key].getCapabilities()""", self._global_key)

    async def get_state(self) -> dict[str, object]:
        if not await self._has_bridge():
            raise RuntimeError('VACP window bridge not available')
        return await self._page.evaluate("""(key) => globalThis[key].getState()""", self._global_key)

    async def execute(self, call: ActionCall) -> ActionResult:
        if not await self._has_bridge():
            raise RuntimeError('VACP window bridge not available')
        payload = {'callId': call.call_id, 'name': call.name, 'params': call.params}
        raw = await self._page.evaluate(
            """({ key, payload }) => globalThis[key].execute(payload)""",
            {'key': self._global_key, 'payload': payload},
        )
        # Ensure the shape matches ActionResult (best-effort).
        if isinstance(raw, dict) and 'callId' in raw and 'ok' in raw:
            return ActionResult(
                call_id=str(raw.get('callId')),
                ok=bool(raw.get('ok')),
                result=raw.get('result'),
                error=raw.get('error') if isinstance(raw.get('error'), dict) else None,
            )
        return ActionResult(call_id=call.call_id, ok=False, error={'message': 'Invalid execute() response', 'raw': raw})


def safe_json_dumps(value: object) -> str:
    try:
        return json.dumps(value)
    except Exception:
        return '"<unserializable>"'
