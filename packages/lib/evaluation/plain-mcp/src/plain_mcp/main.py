from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Awaitable, Callable, MutableMapping
from contextlib import asynccontextmanager
from typing import Any, Literal, Protocol, cast
from urllib.parse import urljoin, urlsplit, urlunsplit

import uvicorn
from fastapi import FastAPI
from vacp_mcp_server.browser import BrowserConfig, BrowserManager

from plain_mcp.registry import USE_CASE_IDS, UseCaseId, get_use_case
from plain_mcp.runtime import PlainMcpRuntime
from plain_mcp.server import create_mcp

type SelectorState = Literal['attached', 'detached', 'hidden', 'visible']
type Scope = MutableMapping[str, Any]
type Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
type Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]


class NavigablePage(Protocol):
    @property
    def url(self) -> str: ...

    async def goto(self, url: str) -> object | None: ...


class BrowserSession(Protocol):
    @property
    def page(self) -> NavigablePage: ...


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def compose_url(base_url: str, route: str) -> str:
    base_parts = urlsplit(base_url)
    base_path = base_parts.path if base_parts.path.endswith('/') else f'{base_parts.path}/'
    base = urlunsplit(base_parts._replace(path=base_path))
    joined_parts = urlsplit(urljoin(base, route.lstrip('/')))
    query = joined_parts.query or base_parts.query
    return urlunsplit(joined_parts._replace(query=query))


async def _ensure_target_page(
    browser: BrowserSession,
    *,
    target_url: str,
    reuse_page_url_contains: str | None,
) -> None:
    current_url = browser.page.url or ''
    if reuse_page_url_contains and reuse_page_url_contains in current_url:
        return
    if current_url != target_url:
        await browser.page.goto(target_url)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description='Semantic visual analytics action server')
    p.add_argument(
        'use_case', type=str.upper, choices=USE_CASE_IDS, help='Use case id to expose: UC1, UC2, UC3, UC4, or UC5.'
    )
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
    p.add_argument('--url', type=str, default='http://localhost:5173/', help='Base URL to open.')
    p.add_argument('--host', type=str, default='127.0.0.1')
    p.add_argument('--port', type=int, default=8000)
    p.add_argument('--headless', action='store_true', default=False)
    p.add_argument('--browser-type', type=str, choices=['chromium', 'firefox', 'webkit'], default='chromium')
    p.add_argument('--browser-path', type=str, default=None)
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
    p.add_argument('--global-key', type=str, default='__vacp', help='Accepted for CLI parity with vacp-mcp-server.')
    p.add_argument(
        '--enable-browser-tools',
        action='store_true',
        default=False,
        help='Accepted for CLI parity. Plain MCP exposes semantic tools only.',
    )
    p.add_argument(
        '--startup-wait-for-bridge',
        action='store_true',
        default=False,
        help='Before exposing MCP, wait for bridge readiness on the initial page.',
    )
    p.add_argument(
        '--startup-ready-timeout-ms',
        type=int,
        default=30_000,
        help='Accepted for CLI parity with vacp-mcp-server.',
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
    wait_for_bridge: bool,
    global_key: str,
    bridge_timeout_ms: int,
    wait_for_selector: str | None,
    selector_timeout_ms: int,
    selector_state: SelectorState | None,
) -> None:
    if wait_for_bridge:
        await PlainMcpRuntime(browser.page, global_key=global_key).wait_ready(bridge_timeout_ms)
    if wait_for_selector:
        await browser.page.wait_for_selector(
            wait_for_selector,
            timeout=max(0, selector_timeout_ms),
            state=selector_state,
        )


async def _run_stdio(
    *,
    use_case: UseCaseId,
    browser: BrowserManager,
    show_banner: bool,
    mcp_log_level: str | None,
    global_key: str,
    target_url: str,
    reuse_page_url_contains: str | None,
    startup_wait_for_bridge: bool,
    startup_ready_timeout_ms: int,
    startup_wait_for_selector: str | None,
    startup_selector_timeout_ms: int,
    startup_selector_state: SelectorState | None,
) -> None:
    await browser.start()
    try:
        await _ensure_target_page(browser, target_url=target_url, reuse_page_url_contains=reuse_page_url_contains)
        await _wait_for_startup_ready(
            browser=browser,
            wait_for_bridge=startup_wait_for_bridge,
            global_key=global_key,
            bridge_timeout_ms=startup_ready_timeout_ms,
            wait_for_selector=startup_wait_for_selector,
            selector_timeout_ms=startup_selector_timeout_ms,
            selector_state=startup_selector_state,
        )
        info = await browser.get_page_info()
        log(f'Browser ready: {info}')

        mcp = create_mcp(get_use_case(use_case), page=browser.page, global_key=global_key)
        await mcp.run_stdio_async(show_banner=show_banner, log_level=mcp_log_level)
    finally:
        await browser.stop()


def main() -> None:
    args = parse_args()
    use_case = cast(UseCaseId, args.use_case)
    use_case_spec = get_use_case(use_case)
    ports = tuple(int(p) for p in str(args.auto_attach_cdp_ports).split(',') if p.strip().isdigit())
    target_url = compose_url(args.url, use_case_spec.route)

    config = BrowserConfig(
        browser_type=args.browser_type,
        browser_path=args.browser_path,
        headless=args.headless,
        url=target_url,
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
                use_case=use_case,
                browser=browser,
                show_banner=bool(args.show_banner),
                mcp_log_level=args.mcp_log_level,
                global_key=args.global_key,
                target_url=target_url,
                reuse_page_url_contains=args.reuse_page_url_contains,
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
    async def lifespan(app: FastAPI):  # noqa: ARG001
        nonlocal mcp_app
        await browser.start()
        try:
            await _ensure_target_page(
                browser,
                target_url=target_url,
                reuse_page_url_contains=args.reuse_page_url_contains,
            )
            await _wait_for_startup_ready(
                browser=browser,
                wait_for_bridge=bool(args.startup_wait_for_bridge),
                global_key=args.global_key,
                bridge_timeout_ms=max(0, int(args.startup_ready_timeout_ms)),
                wait_for_selector=args.startup_wait_for_selector,
                selector_timeout_ms=max(0, int(args.startup_selector_timeout_ms)),
                selector_state=startup_selector_state,
            )
            info = await browser.get_page_info()
            log(f'Browser ready: {info}')

            mcp = create_mcp(use_case_spec, page=browser.page, global_key=args.global_key)
            mcp_app = mcp.http_app(path='/')

            async with mcp_app.router.lifespan_context(app):
                yield
        finally:
            await browser.stop()

    app = FastAPI(title=f'Visual Analytics Actions Server {use_case}', lifespan=lifespan)

    @app.get('/healthz')
    async def healthz() -> dict[str, str]:
        return {'status': 'ok', 'useCase': use_case}

    app.mount('/mcp', LazyMount(lambda: mcp_app))

    uvicorn.run(app, host=args.host, port=args.port, timeout_keep_alive=2, timeout_graceful_shutdown=10)


class LazyMount:
    def __init__(self, get_app: Callable[[], Any]):
        self._get_app = get_app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        app = self._get_app()
        if app is None:
            raise RuntimeError('MCP app not initialized yet')
        await app(scope, receive, send)


if __name__ == '__main__':
    main()
