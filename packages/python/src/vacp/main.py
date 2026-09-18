"""CLI entrypoint for serving a browser-backed VACP bridge over MCP."""

from __future__ import annotations

import argparse
import asyncio
import sys
from contextlib import asynccontextmanager
from importlib.metadata import version
from typing import Literal, cast

import uvicorn
from fastapi import FastAPI

from vacp.bridge import PlaywrightVacpBridgeClient
from vacp.browser import BrowserConfig, BrowserManager
from vacp.server import _wait_for_bridge_ready, create_mcp


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


type SelectorState = Literal['attached', 'detached', 'hidden', 'visible']


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog='vacp', description='Expose a VACP-enabled web page over MCP.')
    p.add_argument('--version', action='version', version=f'vacp {version("vacp")}')
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
        help='Print the FastMCP banner to stderr.',
    )
    p.add_argument(
        '--mcp-log-level',
        type=str,
        default=None,
        help='Optional log level override for FastMCP (stdio mode).',
    )
    p.add_argument('--url', type=str, default='http://localhost:5173/', help='URL to open.')
    p.add_argument('--host', type=str, default='0.0.0.0', help='Host for the HTTP MCP server.')
    p.add_argument('--port', type=int, default=8000, help='Port for the HTTP MCP server.')
    p.add_argument('--headless', action='store_true', default=False, help='Run the browser without a visible window.')
    p.add_argument(
        '--browser-type',
        type=str,
        choices=['chromium', 'firefox', 'webkit'],
        default='chromium',
        help='Playwright browser type.',
    )
    p.add_argument('--browser-path', type=str, default=None, help='Path to a browser executable.')
    p.add_argument(
        '--window-mode',
        type=str,
        choices=['default', 'maximized', 'fullscreen'],
        default='fullscreen',
        help='Initial embedded browser window size mode. Chromium only.',
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
        help='If --cdp-url is not set, try common Chromium CDP endpoints before launching a browser.',
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
        help='If using --cdp-url, request remote browser close on exit.',
    )
    p.add_argument(
        '--global-key',
        type=str,
        default='__vacp',
        help='Window global that contains the VACP bridge (default: __vacp).',
    )
    p.add_argument(
        '--enable-browser-tools',
        action='store_true',
        default=False,
        help=(
            'Expose browser-control MCP tools: screenshot, eval, wait-for-selector, click, fill, press, and sleep. '
            'Off by default.'
        ),
    )
    p.add_argument(
        '--startup-wait-for-bridge',
        action='store_true',
        default=False,
        help='Before exposing MCP, wait for VACP bridge readiness on the initial page.',
    )
    p.add_argument(
        '--startup-ready-timeout-ms',
        type=int,
        default=30_000,
        help='Timeout in ms for --startup-wait-for-bridge (default: 30000).',
    )
    p.add_argument(
        '--startup-wait-for-selector',
        type=str,
        default=None,
        help='Before exposing MCP, wait for this selector on the initial page.',
    )
    p.add_argument(
        '--startup-selector-timeout-ms',
        type=int,
        default=30_000,
        help='Timeout in ms for --startup-wait-for-selector (default: 30000).',
    )
    p.add_argument(
        '--startup-selector-state',
        type=str,
        choices=['attached', 'detached', 'visible', 'hidden'],
        default='visible',
        help='Optional state for --startup-wait-for-selector (default: visible).',
    )
    return p.parse_args(argv)


async def _wait_for_startup_ready(
    *,
    browser: BrowserManager,
    global_key: str,
    wait_for_bridge: bool,
    ready_timeout_ms: int,
    wait_for_selector: str | None,
    selector_timeout_ms: int,
    selector_state: SelectorState | None,
) -> None:
    if wait_for_bridge:
        client = PlaywrightVacpBridgeClient(browser.page, global_key=global_key)
        await _wait_for_bridge_ready(client, ready_timeout_ms)
    if wait_for_selector:
        await browser.page.wait_for_selector(
            wait_for_selector,
            timeout=max(0, selector_timeout_ms),
            state=selector_state,
        )


async def _run_stdio(
    *,
    browser: BrowserManager,
    global_key: str,
    show_banner: bool,
    mcp_log_level: str | None,
    enable_browser_tools: bool,
    startup_wait_for_bridge: bool,
    startup_ready_timeout_ms: int,
    startup_wait_for_selector: str | None,
    startup_selector_timeout_ms: int,
    startup_selector_state: SelectorState | None,
) -> None:
    await browser.start()
    await _wait_for_startup_ready(
        browser=browser,
        global_key=global_key,
        wait_for_bridge=startup_wait_for_bridge,
        ready_timeout_ms=startup_ready_timeout_ms,
        wait_for_selector=startup_wait_for_selector,
        selector_timeout_ms=startup_selector_timeout_ms,
        selector_state=startup_selector_state,
    )
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
    startup_selector_state = cast(SelectorState | None, args.startup_selector_state)

    if args.transport == 'stdio':
        asyncio.run(
            _run_stdio(
                browser=browser,
                global_key=args.global_key,
                show_banner=bool(args.show_banner),
                mcp_log_level=args.mcp_log_level,
                enable_browser_tools=bool(args.enable_browser_tools),
                startup_wait_for_bridge=bool(args.startup_wait_for_bridge),
                startup_ready_timeout_ms=max(0, int(args.startup_ready_timeout_ms)),
                startup_wait_for_selector=args.startup_wait_for_selector,
                startup_selector_timeout_ms=max(0, int(args.startup_selector_timeout_ms)),
                startup_selector_state=startup_selector_state,
            )
        )
        return

    mcp_app = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal mcp_app
        await browser.start()
        await _wait_for_startup_ready(
            browser=browser,
            global_key=args.global_key,
            wait_for_bridge=bool(args.startup_wait_for_bridge),
            ready_timeout_ms=max(0, int(args.startup_ready_timeout_ms)),
            wait_for_selector=args.startup_wait_for_selector,
            selector_timeout_ms=max(0, int(args.startup_selector_timeout_ms)),
            selector_state=startup_selector_state,
        )
        info = await browser.get_page_info()
        log(f'Browser ready: {info}')

        client = PlaywrightVacpBridgeClient(browser.page, global_key=args.global_key)
        mcp = create_mcp(client, page=browser.page, enable_browser_tools=bool(args.enable_browser_tools))
        # FastMCP sees / because FastAPI mounts this ASGI app at /mcp.
        mcp_app = mcp.http_app(path='/')

        try:
            async with mcp_app.router.lifespan_context(app):
                yield
        finally:
            await browser.stop()

    app = FastAPI(title='VACP MCP Server', lifespan=lifespan)

    @app.get('/healthz')
    async def healthz() -> dict[str, str]:
        return {'status': 'ok'}

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
