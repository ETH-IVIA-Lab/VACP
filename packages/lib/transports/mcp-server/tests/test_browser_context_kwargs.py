from __future__ import annotations

from vacp_mcp_server.browser import BrowserConfig, BrowserManager


def test_context_kwargs_headed_defaults_to_no_viewport() -> None:
    mgr = BrowserManager(BrowserConfig(headless=False))
    assert mgr._context_kwargs() == {'no_viewport': True}


def test_context_kwargs_headless_uses_playwright_defaults_by_default() -> None:
    mgr = BrowserManager(BrowserConfig(headless=True))
    assert mgr._context_kwargs() == {}


def test_context_kwargs_headless_uses_screen_hint_as_viewport() -> None:
    mgr = BrowserManager(BrowserConfig(headless=True, screen_width=1600, screen_height=900))
    assert mgr._context_kwargs() == {'viewport': {'width': 1600, 'height': 900}}
