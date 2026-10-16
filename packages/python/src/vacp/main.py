"""CLI entrypoint for serving a browser-backed VACP bridge over MCP."""

from __future__ import annotations

import argparse
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from importlib.metadata import version

from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from vacp.bridge import PlaywrightVacpBridgeClient
from vacp.browser import BrowserConfig, BrowserManager
from vacp.server import create_mcp, wait_for_vacp_bridge


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _milliseconds(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError('expected a non-negative number of milliseconds')
    return parsed


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
    p.add_argument(
        '--host',
        type=str,
        default='127.0.0.1',
        help='Interface for the HTTP MCP server. Pass 0.0.0.0 to accept other machines.',
    )
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
        type=_milliseconds,
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
        type=_milliseconds,
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


def main() -> None:
    args = parse_args()
    ports = tuple(int(p) for p in str(args.auto_attach_cdp_ports).split(',') if p.strip().isdigit())
    browser = BrowserManager(
        BrowserConfig(
            browser_type=args.browser_type,
            browser_path=args.browser_path,
            headless=args.headless,
            url=args.url,
            window_mode=args.window_mode,
            screen_width=args.screen_width,
            screen_height=args.screen_height,
            cdp_url=args.cdp_url,
            auto_attach_cdp=args.auto_attach_cdp,
            auto_attach_cdp_ports=ports or (9222, 9223),
            reuse_page_url_contains=args.reuse_page_url_contains,
        )
    )
    client = PlaywrightVacpBridgeClient(lambda: browser.page, global_key=args.global_key)

    @asynccontextmanager
    async def lifespan(_server: FastMCP[None]) -> AsyncGenerator[None]:
        async with browser.session() as page:
            if args.startup_wait_for_bridge:
                await wait_for_vacp_bridge(client, args.startup_ready_timeout_ms)
            if args.startup_wait_for_selector:
                await page.wait_for_selector(
                    args.startup_wait_for_selector,
                    timeout=args.startup_selector_timeout_ms,
                    state=args.startup_selector_state,
                )
            log(f'Browser ready: {await browser.get_page_info()}')
            yield

    mcp = create_mcp(
        client, page=lambda: browser.page, enable_browser_tools=args.enable_browser_tools, lifespan=lifespan
    )
    if args.transport == 'stdio':
        mcp.run('stdio', show_banner=args.show_banner, log_level=args.mcp_log_level)
        return

    @mcp.custom_route('/healthz', methods=['GET'])
    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({'status': 'ok'})

    mcp.run(
        'http',
        show_banner=args.show_banner,
        host=args.host,
        port=args.port,
        path='/mcp',
        uvicorn_config={'timeout_keep_alive': 2, 'timeout_graceful_shutdown': 10},
    )


if __name__ == '__main__':
    main()
