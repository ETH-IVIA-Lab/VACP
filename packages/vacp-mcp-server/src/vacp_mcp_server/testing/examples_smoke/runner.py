from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import Page, async_playwright

from .devserver import DevServer, free_port, start_vite_dev_server
from .tests_d3 import test_d3_scatter_lasso
from .tests_mosaic import test_mosaic_gallery
from .tests_overlay import test_debug_overlay
from .tests_vega_lite import test_vega_lite_gallery


@dataclass(frozen=True)
class ExampleSuite:
    name: str
    dev_cwd: Path
    test: Callable[[Page], Awaitable[None]]


async def run_examples_smoke(*, vacp_root: Path, artifacts_dir: Path) -> int:
    examples_dir = vacp_root / 'packages' / 'examples'
    suites = [
        ExampleSuite(
            name='mosaic-gallery',
            dev_cwd=examples_dir / 'mosaic-gallery',
            test=test_mosaic_gallery,
        ),
        ExampleSuite(
            name='vega-lite-gallery',
            dev_cwd=examples_dir / 'vega-lite-gallery',
            test=test_vega_lite_gallery,
        ),
        ExampleSuite(
            name='d3-scatter-lasso',
            dev_cwd=examples_dir / 'd3-scatter-lasso',
            test=test_d3_scatter_lasso,
        ),
    ]

    servers: list[DevServer] = []
    try:
        for suite in suites:
            port = free_port()
            srv = await start_vite_dev_server(suite.name, suite.dev_cwd, port, artifacts_dir)
            servers.append(srv)

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            ctx = await browser.new_context()

            for suite, srv in zip(suites, servers, strict=True):
                page = await ctx.new_page()
                await page.goto(srv.url + '?vacpDebug=1', wait_until='domcontentloaded')
                await test_debug_overlay(page)
                await suite.test(page)
                await page.close()

            await ctx.close()
            await browser.close()
    finally:
        for srv in servers:
            await srv.stop()

    print('OK: examples smoke tests passed')
    return 0


def run_examples_smoke_sync(*, vacp_root: Path, artifacts_dir: Path) -> int:
    return asyncio.run(run_examples_smoke(vacp_root=vacp_root, artifacts_dir=artifacts_dir))
