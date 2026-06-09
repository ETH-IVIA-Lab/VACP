from __future__ import annotations

import pytest
from plain_mcp.main import _ensure_target_page, compose_url, parse_args


class _Page:
    def __init__(self, url: str) -> None:
        self.url = url
        self.goto_calls: list[str] = []

    async def goto(self, url: str) -> object | None:
        self.goto_calls.append(url)
        self.url = url
        return None


class _Browser:
    def __init__(self, url: str) -> None:
        self.page = _Page(url)


def test_parse_args_requires_use_case() -> None:
    args = parse_args(['UC1'])
    assert args.use_case == 'UC1'
    assert args.transport == 'http'
    assert args.url == 'http://localhost:5173/'
    assert args.host == '127.0.0.1'


def test_parse_args_accepts_lowercase_use_case() -> None:
    args = parse_args(['uc5', '--stdio'])
    assert args.use_case == 'UC5'
    assert args.transport == 'stdio'


def test_parse_args_accepts_vacp_mcp_server_browser_flags() -> None:
    args = parse_args(
        [
            'UC2',
            '--headless',
            '--browser-type',
            'chromium',
            '--window-mode',
            'maximized',
            '--screen-width',
            '1600',
            '--screen-height',
            '900',
            '--auto-attach-cdp',
            '--auto-attach-cdp-ports',
            '9222,9333',
            '--reuse-page-url-contains',
            'seattle-weather',
            '--close-external-on-exit',
            '--startup-wait-for-selector',
            '#app canvas',
            '--startup-selector-state',
            'attached',
        ]
    )

    assert args.headless is True
    assert args.browser_type == 'chromium'
    assert args.window_mode == 'maximized'
    assert args.screen_width == 1600
    assert args.screen_height == 900
    assert args.auto_attach_cdp is True
    assert args.auto_attach_cdp_ports == '9222,9333'
    assert args.reuse_page_url_contains == 'seattle-weather'
    assert args.close_external_on_exit is True
    assert args.startup_wait_for_selector == '#app canvas'
    assert args.startup_selector_state == 'attached'


def test_compose_url_appends_use_case_route_to_base_url() -> None:
    assert compose_url('http://localhost:5173/', '/vega-lite/#airports') == 'http://localhost:5173/vega-lite/#airports'
    assert compose_url('http://localhost:5173', '/cars-parcoords/') == 'http://localhost:5173/cars-parcoords/'


def test_compose_url_preserves_base_query_flags() -> None:
    assert (
        compose_url('http://localhost:5173/?vacp-debug=0&expose-bridge=1', '/vega-lite/#airports')
        == 'http://localhost:5173/vega-lite/?vacp-debug=0&expose-bridge=1#airports'
    )


def test_compose_url_accepts_already_composed_scenario_url() -> None:
    assert (
        compose_url('http://localhost:5173/vega-lite/?vacp-debug=0&expose-bridge=1#airports', '/vega-lite/#airports')
        == 'http://localhost:5173/vega-lite/?vacp-debug=0&expose-bridge=1#airports'
    )


@pytest.mark.asyncio
async def test_ensure_target_page_navigates_wrong_attached_page() -> None:
    browser = _Browser('http://localhost:5173/vega-lite/#seattle-weather')

    await _ensure_target_page(
        browser,
        target_url='http://localhost:5173/vega-lite/#global-development',
        reuse_page_url_contains=None,
    )

    assert browser.page.goto_calls == ['http://localhost:5173/vega-lite/#global-development']


@pytest.mark.asyncio
async def test_ensure_target_page_keeps_explicit_reuse_match() -> None:
    browser = _Browser('http://localhost:5173/vega-lite/#seattle-weather')

    await _ensure_target_page(
        browser,
        target_url='http://localhost:5173/vega-lite/#global-development',
        reuse_page_url_contains='seattle-weather',
    )

    assert browser.page.goto_calls == []
