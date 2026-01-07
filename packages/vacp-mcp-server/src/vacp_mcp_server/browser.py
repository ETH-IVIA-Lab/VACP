from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass

from playwright.async_api import Browser, Page, Playwright, async_playwright

"""
Browser lifecycle layer (project concepts).

The MCP server needs a *live page* to observe and control.
This module supports two workflows:

1) Embedded browser: Playwright launches a new browser instance.
2) External browser: Playwright attaches via CDP to an existing Chromium session.

External browser mode is important for flexibility:
- reuse an already-open app tab (and its state),
- keep cookies/localStorage/profile,
- debug alongside normal developer tools.
"""


@dataclass(frozen=True)
class BrowserConfig:
    browser_type: str = 'chromium'
    browser_path: str | None = None
    headless: bool = False
    url: str = 'http://localhost:5173/'
    # Optional: connect to an existing Chromium-based browser via CDP.
    # Examples:
    # - http://localhost:9222
    # - ws://127.0.0.1:9222/devtools/browser/<id>
    cdp_url: str | None = None
    # If connecting to external browser: whether to close it on shutdown.
    # For CDP connections, Playwright typically only disconnects, but we keep
    # this flag for explicitness.
    close_on_exit: bool = False
    # If connecting to external browser, try to reuse an existing page whose URL
    # contains this substring. If not found, a new page is created and navigated.
    reuse_page_url_contains: str | None = None


class BrowserManager:
    def __init__(self, config: BrowserConfig):
        self._config = config
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._page: Page | None = None
        self._launched_browser = False

    @property
    def page(self) -> Page:
        if self._page is None:
            raise RuntimeError('Browser not started')
        return self._page

    async def _select_or_create_page(self) -> Page:
        """
        Select an existing page (if configured), otherwise create one and navigate.
        """
        if self._browser is None:
            raise RuntimeError('Browser not started')

        target_substring = self._config.reuse_page_url_contains
        if target_substring:
            for context in self._browser.contexts:
                for p in context.pages:
                    if target_substring in (p.url or ''):
                        return p

        # Prefer first non-empty page in external browser, if any.
        for context in self._browser.contexts:
            for p in context.pages:
                if p.url and p.url != 'about:blank':
                    return p

        # Otherwise create a new page and navigate.
        context = self._browser.contexts[0] if self._browser.contexts else await self._browser.new_context()
        p = await context.new_page()
        await p.goto(self._config.url)
        return p

    async def start(self) -> None:
        self._playwright = await async_playwright().start()

        if self._config.cdp_url:
            # External browser instance (Chromium only).
            self._browser = await self._playwright.chromium.connect_over_cdp(self._config.cdp_url)
            self._launched_browser = False
            self._page = await self._select_or_create_page()
            return

        if self._config.browser_type == 'chromium':
            launcher = self._playwright.chromium
        elif self._config.browser_type == 'firefox':
            launcher = self._playwright.firefox
        else:
            launcher = self._playwright.webkit

        self._browser = await launcher.launch(headless=self._config.headless, executable_path=self._config.browser_path)
        self._launched_browser = True
        self._page = await self._browser.new_page()
        await self._page.goto(self._config.url)

    async def stop(self) -> None:
        if self._browser is not None:
            with suppress(Exception):
                if self._launched_browser:
                    await self._browser.close()
                else:
                    if self._config.close_on_exit:
                        await self._browser.close()
                    else:
                        # For external browsers, prefer to just disconnect.
                        await self._browser.close()
        if self._playwright is not None:
            await self._playwright.stop()
        self._browser = None
        self._playwright = None
        self._page = None
        self._launched_browser = False

    async def get_page_info(self) -> dict[str, str]:
        return {'title': await self.page.title(), 'url': self.page.url}
