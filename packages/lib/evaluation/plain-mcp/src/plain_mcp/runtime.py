from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable
from typing import Any, Protocol, cast

from vacp_mcp_server.bridge import ActionCall, PlaywrightVacpBridgeClient
from vacp_mcp_server.models import VacpCapabilitiesRequestOptions, VacpStateRequestOptions

JsonDict = dict[str, object]


class PageLike(Protocol):
    @property
    def url(self) -> str: ...

    async def evaluate(self, expression: str, arg: Any | None = None) -> Any: ...


def as_dict(value: object | None) -> JsonDict:
    return cast(JsonDict, value) if isinstance(value, dict) else {}


class PlainMcpRuntime:
    def __init__(self, page: PageLike, *, global_key: str = '__vacp'):
        self._page = page
        self._bridge = PlaywrightVacpBridgeClient(cast(Any, page), global_key=global_key)
        self._local: dict[str, object] = {}

    @property
    def page_url(self) -> str:
        return self._page.url

    def remember(self, key: str, value: object | None) -> None:
        if value is None:
            self._local.pop(key, None)
        else:
            self._local[key] = value

    def recall(self, key: str) -> object | None:
        return self._local.get(key)

    async def wait_ready(self, timeout_ms: int) -> None:
        deadline = time.monotonic() + max(0, timeout_ms) / 1000
        last_error: Exception | None = None

        while True:
            try:
                await self.capabilities()
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc

            if time.monotonic() >= deadline:
                raise RuntimeError(f'Timed out waiting for VACP bridge after {timeout_ms}ms') from last_error

            await asyncio.sleep(0.1)

    async def capabilities(self, request: VacpCapabilitiesRequestOptions | None = None) -> JsonDict:
        return await self._bridge.get_capabilities(request)

    async def state(self, request: VacpStateRequestOptions | None = None) -> JsonDict:
        return await self._bridge.get_state(request)

    def state_entry(self, snapshot: JsonDict, ref: str) -> JsonDict:
        state = as_dict(snapshot.get('state'))
        return as_dict(state.get(ref))

    async def execute(self, name: str, params: JsonDict | None = None) -> object | None:
        call = ActionCall(call_id=str(uuid.uuid4()), name=name, params=params)
        result = await self._bridge.execute(call)
        if result.ok:
            return result.result
        message = 'Action failed'
        if result.error:
            raw = result.error.get('message')
            if isinstance(raw, str) and raw:
                message = raw
        raise RuntimeError(message)

    async def sql(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> JsonDict:
        result = await self.execute(
            'vacp.data_sql',
            {'handleRef': handle_ref, 'sql': sql, 'format': 'json', 'maxRows': max_rows},
        )
        return as_dict(result)

    async def rows(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> list[JsonDict]:
        result = await self.sql(handle_ref, sql, max_rows=max_rows)
        rows = result.get('rows')
        if not isinstance(rows, list):
            return []
        return [as_dict(row) for row in rows]

    async def browser_value(self, expression: str, arg: object | None = None) -> object:
        return await self._page.evaluate(expression, arg)


RuntimeFactory = Callable[[PageLike], PlainMcpRuntime]
