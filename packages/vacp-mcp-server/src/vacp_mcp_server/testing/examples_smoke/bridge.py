from __future__ import annotations

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
