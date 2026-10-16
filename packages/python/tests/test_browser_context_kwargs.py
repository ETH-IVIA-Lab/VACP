from __future__ import annotations

from typing import Any

import pytest
import vacp.browser as browser_module
from vacp.browser import BrowserConfig, BrowserManager


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
    def __init__(self, browser: _FakeBrowser, failure: Exception | None = None) -> None:
        self.browser = browser
        self.failure = failure

    async def launch(self, **kwargs: Any) -> _FakeBrowser:
        if self.failure:
            raise self.failure
        return self.browser


class _FakePlaywright:
    def __init__(self, failure: Exception | None = None) -> None:
        self.browser = _FakeBrowser()
        self.chromium = _FakeLauncher(self.browser, failure)
        self.firefox = _FakeLauncher(self.browser, failure)
        self.webkit = _FakeLauncher(self.browser, failure)
        self.stopped = False

    async def stop(self) -> None:
        self.stopped = True


class _FakePlaywrightFactory:
    def __init__(self, playwright: _FakePlaywright) -> None:
        self.playwright = playwright

    async def start(self) -> _FakePlaywright:
        return self.playwright


async def _context_kwargs(config: BrowserConfig, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any] | None:
    fake_playwright = _FakePlaywright()
    monkeypatch.setattr(browser_module, 'async_playwright', lambda: _FakePlaywrightFactory(fake_playwright))
    async with BrowserManager(config).session():
        kwargs = fake_playwright.browser.context_kwargs
    assert fake_playwright.stopped
    return kwargs


@pytest.mark.asyncio
async def test_start_keeps_headed_browser_context_at_os_window_size(monkeypatch: pytest.MonkeyPatch) -> None:
    assert await _context_kwargs(BrowserConfig(headless=False), monkeypatch) == {'no_viewport': True}


@pytest.mark.asyncio
async def test_start_uses_playwright_headless_default_viewport(monkeypatch: pytest.MonkeyPatch) -> None:
    assert await _context_kwargs(BrowserConfig(headless=True), monkeypatch) == {}


@pytest.mark.asyncio
async def test_start_uses_screen_hint_as_headless_viewport(monkeypatch: pytest.MonkeyPatch) -> None:
    config = BrowserConfig(headless=True, screen_width=1600, screen_height=900)
    assert await _context_kwargs(config, monkeypatch) == {'viewport': {'width': 1600, 'height': 900}}


@pytest.mark.asyncio
async def test_a_browser_that_fails_to_launch_still_releases_playwright(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_playwright = _FakePlaywright(RuntimeError('no browser'))
    monkeypatch.setattr(browser_module, 'async_playwright', lambda: _FakePlaywrightFactory(fake_playwright))
    with pytest.raises(RuntimeError, match='no browser'):
        async with BrowserManager(BrowserConfig(headless=True)).session():
            pass
    assert fake_playwright.stopped
