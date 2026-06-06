from __future__ import annotations

from typing import Any

import pytest
import vacp_mcp_server.browser as browser_module
from vacp_mcp_server.browser import BrowserConfig, BrowserManager


class _FakePage:
    def __init__(self) -> None:
        self.url = 'about:blank'

    async def goto(self, url: str) -> None:
        self.url = url


class _FakeContext:
    def __init__(self) -> None:
        self.page = _FakePage()

    async def new_page(self) -> _FakePage:
        return self.page


class _FakeBrowser:
    def __init__(self) -> None:
        self.contexts: list[_FakeContext] = []
        self.context_kwargs: dict[str, Any] | None = None
        self.context = _FakeContext()

    async def new_context(self, **kwargs: Any) -> _FakeContext:
        self.context_kwargs = kwargs
        return self.context

    async def close(self) -> None:
        return None


class _FakeLauncher:
    def __init__(self, browser: _FakeBrowser) -> None:
        self.browser = browser

    async def launch(self, **kwargs: Any) -> _FakeBrowser:
        return self.browser


class _FakePlaywright:
    def __init__(self) -> None:
        self.browser = _FakeBrowser()
        self.chromium = _FakeLauncher(self.browser)
        self.firefox = _FakeLauncher(self.browser)
        self.webkit = _FakeLauncher(self.browser)

    async def stop(self) -> None:
        return None


class _FakePlaywrightFactory:
    def __init__(self, playwright: _FakePlaywright) -> None:
        self.playwright = playwright

    async def start(self) -> _FakePlaywright:
        return self.playwright


async def _start_with_config(
    config: BrowserConfig,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[BrowserManager, _FakePlaywright]:
    fake_playwright = _FakePlaywright()
    monkeypatch.setattr(browser_module, 'async_playwright', lambda: _FakePlaywrightFactory(fake_playwright))
    manager = BrowserManager(config)
    await manager.start()
    return manager, fake_playwright


@pytest.mark.asyncio
async def test_start_keeps_headed_browser_context_at_os_window_size(monkeypatch: pytest.MonkeyPatch) -> None:
    manager, fake_playwright = await _start_with_config(BrowserConfig(headless=False), monkeypatch)
    try:
        assert fake_playwright.browser.context_kwargs == {'no_viewport': True}
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_start_uses_playwright_headless_default_viewport(monkeypatch: pytest.MonkeyPatch) -> None:
    manager, fake_playwright = await _start_with_config(BrowserConfig(headless=True), monkeypatch)
    try:
        assert fake_playwright.browser.context_kwargs == {}
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_start_uses_screen_hint_as_headless_viewport(monkeypatch: pytest.MonkeyPatch) -> None:
    manager, fake_playwright = await _start_with_config(
        BrowserConfig(headless=True, screen_width=1600, screen_height=900),
        monkeypatch,
    )
    try:
        assert fake_playwright.browser.context_kwargs == {'viewport': {'width': 1600, 'height': 900}}
    finally:
        await manager.stop()
