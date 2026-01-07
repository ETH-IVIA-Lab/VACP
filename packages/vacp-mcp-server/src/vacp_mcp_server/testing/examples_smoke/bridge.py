from __future__ import annotations

import asyncio
import time
from typing import Any

from playwright.async_api import Page


async def expect_bridge(page: Page) -> None:
    await page.wait_for_function(
        '() => !!globalThis.__vacp && '
        "typeof globalThis.__vacp.getCapabilities === 'function' && "
        "typeof globalThis.__vacp.getRuntime === 'function'"
    )


async def get_capabilities(page: Page) -> dict[str, Any]:
    return await page.evaluate('async () => await globalThis.__vacp.getCapabilities()')


async def get_state(page: Page) -> dict[str, Any]:
    return await page.evaluate('async () => await globalThis.__vacp.getState()')


async def get_runtime(page: Page) -> dict[str, Any]:
    return await page.evaluate('async () => await globalThis.__vacp.getRuntime()')


async def execute(page: Page, name: str, params: dict[str, Any]) -> dict[str, Any]:
    return await page.evaluate(
        'async ({name, params}) => await globalThis.__vacp.execute({callId: crypto.randomUUID(), name, params})',
        {'name': name, 'params': params},
    )


async def data_sql(page: Page, *, handle_ref: str, sql: str, max_rows: int = 500) -> dict[str, Any]:
    return await execute(
        page,
        'vacp.data_sql',
        {'handleRef': handle_ref, 'sql': sql, 'format': 'json', 'maxRows': max_rows},
    )


async def _wait_for_async(predicate, *, timeout_ms: int, poll_ms: int = 100) -> None:
    start = time.monotonic()
    while True:
        if await predicate():
            return
        if (time.monotonic() - start) * 1000.0 > timeout_ms:
            raise TimeoutError('Timed out waiting for condition')
        await asyncio.sleep(poll_ms / 1000.0)


async def wait_for_capability_ref_contains(page: Page, needle: str, *, timeout_ms: int = 60_000) -> None:
    async def pred() -> bool:
        caps = await get_capabilities(page)
        nodes = caps.get('graph', {}).get('nodes', [])
        return any(isinstance(n, dict) and needle in str(n.get('ref', '')) for n in nodes)

    await _wait_for_async(pred, timeout_ms=timeout_ms, poll_ms=150)


async def wait_for_history_len_at_least(page: Page, n: int, *, timeout_ms: int = 15_000) -> None:
    async def pred() -> bool:
        rt = await get_runtime(page)
        hist = rt.get('history', [])
        return isinstance(hist, list) and len(hist) >= n

    await _wait_for_async(pred, timeout_ms=timeout_ms, poll_ms=120)


async def wait_for_runtime_changed(
    page: Page,
    *,
    before_len: int,
    before_last_at: str,
    timeout_ms: int = 15_000,
) -> None:
    async def pred() -> bool:
        rt = await get_runtime(page)
        hist = rt.get('history', [])
        if not isinstance(hist, list):
            return False
        if len(hist) > before_len:
            return True
        last_at = str(hist[-1].get('at')) if hist else ''
        return bool(before_last_at and last_at and last_at != before_last_at)

    await _wait_for_async(pred, timeout_ms=timeout_ms, poll_ms=120)
