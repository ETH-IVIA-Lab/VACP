from __future__ import annotations

import argparse
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from vacp_mcp_server.browser import BrowserConfig, BrowserManager
from vacp_mcp_server.server import create_mcp
from vacp_mcp_server.surfaces.playwright_bridge import PlaywrightBridgeSurface
from vacp_mcp_server.surfaces.playwright_dom import DomScanOptions, PlaywrightDomSurface

"""
VACP MCP server entrypoint (project concepts).

This process runs a browser (either launched by Playwright or an external
browser attached via CDP), then exposes VACP through MCP.

Two observation/control strategies:
- preferred: `window.__vacp` bridge (stable, semantic, fast)
- fallback: DOM/SVG scan for `data-vacp-*` and embedded SVG metadata

The CLI exists to support both local dev workflows:
- embedded browser: quick start, hermetic
- external browser: reuse profiles/tabs/state, more flexible debugging
"""


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description='VACP MCP Server (bridge-first, DOM fallback)')
    p.add_argument('--url', type=str, default='http://localhost:5173/', help='URL to open')
    p.add_argument('--host', type=str, default='0.0.0.0')
    p.add_argument('--port', type=int, default=8000)
    p.add_argument('--headless', action='store_true', default=False)
    p.add_argument('--browser-type', type=str, choices=['chromium', 'firefox', 'webkit'], default='chromium')
    p.add_argument('--browser-path', type=str, default=None)
    p.add_argument(
        '--cdp-url',
        type=str,
        default=None,
        help='Connect to an existing Chromium browser via CDP (e.g. http://localhost:9222).',
    )
    p.add_argument(
        '--reuse-page-url-contains',
        type=str,
        default=None,
        help='If using --cdp-url, reuse an existing page whose URL contains this substring.',
    )
    p.add_argument(
        '--close-external-on-exit',
        action='store_true',
        default=False,
        help='If using --cdp-url, attempt to close the remote browser on exit (usually disconnects only).',
    )
    p.add_argument('--global-key', type=str, default='__vacp', help='Global key for window bridge (default: __vacp)')
    p.add_argument('--no-dom-fallback', action='store_true', default=False, help='Disable DOM scan fallback')
    return p.parse_args()


def main() -> None:
    args = parse_args()

    config = BrowserConfig(
        browser_type=args.browser_type,
        browser_path=args.browser_path,
        headless=args.headless,
        url=args.url,
        cdp_url=args.cdp_url,
        close_on_exit=args.close_external_on_exit,
        reuse_page_url_contains=args.reuse_page_url_contains,
    )
    browser = BrowserManager(config)

    mcp_app = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal mcp_app
        await browser.start()
        info = await browser.get_page_info()
        log(f'Browser ready: {info}')

        bridge_surface = PlaywrightBridgeSurface(browser.page, global_key=args.global_key)
        if not args.no_dom_fallback:
            surface = CompositeSurface(
                primary=bridge_surface,
                fallback=PlaywrightDomSurface(browser.page, options=DomScanOptions()),
            )
        else:
            surface = bridge_surface

        mcp = create_mcp(surface)
        # We mount the resulting ASGI app under /mcp; therefore its internal path is /.
        mcp_app = mcp.http_app(path='/')

        try:
            async with mcp_app.router.lifespan_context(app):
                yield
        finally:
            await browser.stop()

    app = FastAPI(title='VACP MCP Server', lifespan=lifespan)

    # Mount MCP app after it is created in lifespan.
    @app.get('/healthz')
    async def healthz() -> dict[str, str]:
        return {'status': 'ok'}

    # Lazy mount: the MCP ASGI app depends on the browser page and is created in lifespan.
    app.mount('/mcp', LazyMount(lambda: mcp_app))

    uvicorn.run(app, host=args.host, port=args.port, timeout_keep_alive=2, timeout_graceful_shutdown=10)


class CompositeSurface:
    def __init__(self, *, primary, fallback):
        self._primary = primary
        self._fallback = fallback

    async def get_capabilities(self) -> dict[str, object]:
        try:
            return await self._primary.get_capabilities()
        except Exception:
            return await self._fallback.get_capabilities()

    async def get_state(self) -> dict[str, object]:
        try:
            return await self._primary.get_state()
        except Exception:
            return await self._fallback.get_state()

    async def execute(self, call):
        return await self._primary.execute(call)


class LazyMount:
    """
    Lazily proxies an ASGI app produced after lifespan startup.
    """

    def __init__(self, get_app):
        self._get_app = get_app

    async def __call__(self, scope, receive, send):
        app = self._get_app()
        if app is None:
            raise RuntimeError('MCP app not initialized yet')
        return await app(scope, receive, send)


if __name__ == '__main__':
    main()
