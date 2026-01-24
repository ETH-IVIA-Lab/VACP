from __future__ import annotations

import argparse
import asyncio
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from vacp_mcp_server.bridge import PlaywrightVacpBridgeClient
from vacp_mcp_server.browser import BrowserConfig, BrowserManager
from vacp_mcp_server.server import create_mcp

"""
VACP MCP server entrypoint (project concepts).

This process runs a browser (either launched by Playwright or an external
browser attached via CDP), then exposes VACP through MCP.

The CLI exists to support both local dev workflows:
- embedded browser: quick start, hermetic
- external browser: reuse profiles/tabs/state, more flexible debugging
"""


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description='VACP MCP Server (bridge-only)')
    p.add_argument(
        '--transport',
        type=str,
        choices=['http', 'stdio'],
        default='http',
        help='MCP transport mode: http (ASGI at /mcp) or stdio (stdin/stdout).',
    )
    p.add_argument(
        '--stdio',
        action='store_const',
        dest='transport',
        const='stdio',
        help='Alias for --transport stdio.',
    )
    p.add_argument(
        '--show-banner',
        action='store_true',
        default=False,
        help='Show the FastMCP banner (stderr). Useful for debugging.',
    )
    p.add_argument(
        '--mcp-log-level',
        type=str,
        default=None,
        help='Optional log level override for FastMCP (stdio mode).',
    )
    p.add_argument('--url', type=str, default='http://localhost:5173/', help='URL to open')
    p.add_argument('--host', type=str, default='0.0.0.0')
    p.add_argument('--port', type=int, default=8000)
    p.add_argument('--headless', action='store_true', default=False)
    p.add_argument('--browser-type', type=str, choices=['chromium', 'firefox', 'webkit'], default='chromium')
    p.add_argument('--browser-path', type=str, default=None)
    p.add_argument(
        '--window-mode',
        type=str,
        choices=['default', 'maximized', 'fullscreen'],
        default='fullscreen',
        help='For embedded browsers, best-effort initial window size (chromium only).',
    )
    p.add_argument(
        '--screen-width',
        type=int,
        default=None,
        help='Optional host screen width hint (used to size embedded browser windows).',
    )
    p.add_argument(
        '--screen-height',
        type=int,
        default=None,
        help='Optional host screen height hint (used to size embedded browser windows).',
    )
    p.add_argument(
        '--cdp-url',
        type=str,
        default=None,
        help='Connect to an existing Chromium browser via CDP (e.g. http://localhost:9222).',
    )
    p.add_argument(
        '--auto-attach-cdp',
        action='store_true',
        default=False,
        help='If --cdp-url is not set, try to attach to an already-running Chromium CDP endpoint on common ports.',
    )
    p.add_argument(
        '--auto-attach-cdp-ports',
        type=str,
        default='9222,9223',
        help='Comma-separated CDP ports to probe when --auto-attach-cdp is enabled (default: 9222,9223).',
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
    p.add_argument(
        '--enable-browser-tools',
        action='store_true',
        default=False,
        help='Expose additional browser-control MCP tools (screenshot/eval/etc). Off by default.',
    )
    return p.parse_args(argv)


async def _run_stdio(
    *,
    browser: BrowserManager,
    global_key: str,
    show_banner: bool,
    mcp_log_level: str | None,
    enable_browser_tools: bool,
) -> None:
    await browser.start()
    info = await browser.get_page_info()
    log(f'Browser ready: {info}')

    client = PlaywrightVacpBridgeClient(browser.page, global_key=global_key)
    mcp = create_mcp(client, page=browser.page, enable_browser_tools=enable_browser_tools)
    try:
        await mcp.run_stdio_async(show_banner=show_banner, log_level=mcp_log_level)
    finally:
        await browser.stop()


def main() -> None:
    args = parse_args()
    ports = tuple(int(p) for p in str(args.auto_attach_cdp_ports).split(',') if p.strip().isdigit())

    config = BrowserConfig(
        browser_type=args.browser_type,
        browser_path=args.browser_path,
        headless=args.headless,
        url=args.url,
        window_mode=args.window_mode,
        screen_width=args.screen_width,
        screen_height=args.screen_height,
        cdp_url=args.cdp_url,
        auto_attach_cdp=args.auto_attach_cdp,
        auto_attach_cdp_ports=ports if ports else (9222, 9223),
        close_on_exit=args.close_external_on_exit,
        reuse_page_url_contains=args.reuse_page_url_contains,
    )
    browser = BrowserManager(config)

    if args.transport == 'stdio':
        asyncio.run(
            _run_stdio(
                browser=browser,
                global_key=args.global_key,
                show_banner=bool(args.show_banner),
                mcp_log_level=args.mcp_log_level,
                enable_browser_tools=bool(args.enable_browser_tools),
            )
        )
        return

    mcp_app = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal mcp_app
        await browser.start()
        info = await browser.get_page_info()
        log(f'Browser ready: {info}')

        client = PlaywrightVacpBridgeClient(browser.page, global_key=args.global_key)
        mcp = create_mcp(client, page=browser.page, enable_browser_tools=bool(args.enable_browser_tools))
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
