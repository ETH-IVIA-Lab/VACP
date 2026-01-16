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
    # Optional: explicit Playwright viewport size (useful in headless mode).
    # If unset:
    # - headed mode uses `no_viewport=True` to match the OS window size,
    # - headless mode uses Playwright defaults unless `screen_width/height` are provided.
    viewport_width: int | None = None
    viewport_height: int | None = None
    url: str = 'http://localhost:5173/'
    # For embedded browsers: attempt to open the window in a large, human-usable size.
    # - default: Playwright defaults
    # - maximized: best-effort maximize window
    # - fullscreen: best-effort fullscreen window (Chromium only)
    window_mode: str = 'fullscreen'
    # Optional: hint at host screen size to size the browser window.
    # If unset, the server will try to infer it (best-effort), otherwise fall back to
    # browser defaults.
    screen_width: int | None = None
    screen_height: int | None = None
    # Optional: connect to an existing Chromium-based browser via CDP.
    # Examples:
    # - http://localhost:9222
    # - ws://127.0.0.1:9222/devtools/browser/<id>
    cdp_url: str | None = None
    # Optional: automatically attempt to attach to an already-running Chromium instance
    # via common CDP endpoints before launching an embedded browser.
    auto_attach_cdp: bool = False
    auto_attach_cdp_ports: tuple[int, ...] = (9222, 9223)
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
        self._connected_cdp_url: str | None = None

    @property
    def page(self) -> Page:
        if self._page is None:
            raise RuntimeError('Browser not started')
        return self._page

    def _infer_screen_size(self) -> tuple[int, int] | None:
        """
        Best-effort host screen size detection.

        This is intentionally dependency-free and cross-platform, but not perfect:
        - Use explicit config if provided.
        - Try tkinter (works on many desktop envs).
        - On Windows, fallback to GetSystemMetrics.
        """
        if self._config.screen_width and self._config.screen_height:
            return self._config.screen_width, self._config.screen_height

        with suppress(Exception):
            import tkinter as tk  # noqa: PLC0415

            root = tk.Tk()
            root.withdraw()
            w = int(root.winfo_screenwidth())
            h = int(root.winfo_screenheight())
            root.destroy()
            if w > 0 and h > 0:
                return w, h

        with suppress(Exception):
            import sys  # noqa: PLC0415

            if sys.platform.startswith('win'):
                import ctypes  # noqa: PLC0415

                user32 = ctypes.windll.user32
                w = int(user32.GetSystemMetrics(0))
                h = int(user32.GetSystemMetrics(1))
                if w > 0 and h > 0:
                    return w, h

        return None

    def _context_kwargs(self) -> dict[str, object]:
        """
        Compute Playwright `browser.new_context(...)` kwargs.

        We keep headed mode using OS window sizing (via `no_viewport=True`) unless the
        user explicitly requests a viewport. In headless mode, an explicit viewport is
        often necessary to avoid responsive layouts collapsing to a small default.
        """
        if self._config.viewport_width and self._config.viewport_height:
            return {'viewport': {'width': self._config.viewport_width, 'height': self._config.viewport_height}}

        if self._config.headless and self._config.screen_width and self._config.screen_height:
            return {'viewport': {'width': self._config.screen_width, 'height': self._config.screen_height}}

        if not self._config.headless:
            return {'no_viewport': True}

        return {}

    async def _try_connect_over_cdp(self, url: str) -> Browser | None:
        if self._playwright is None:
            raise RuntimeError('Playwright not started')
        if self._config.browser_type != 'chromium':
            return None
        with suppress(Exception):
            b = await self._playwright.chromium.connect_over_cdp(url)
            self._connected_cdp_url = url
            return b
        return None

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
            self._connected_cdp_url = self._config.cdp_url
            self._page = await self._select_or_create_page()
            return

        if self._config.auto_attach_cdp:
            for port in self._config.auto_attach_cdp_ports:
                for host in ('127.0.0.1', 'localhost'):
                    candidate = f'http://{host}:{port}'
                    b = await self._try_connect_over_cdp(candidate)
                    if b is not None:
                        self._browser = b
                        self._launched_browser = False
                        self._page = await self._select_or_create_page()
                        return

        if self._config.browser_type == 'chromium':
            launcher = self._playwright.chromium
        elif self._config.browser_type == 'firefox':
            launcher = self._playwright.firefox
        else:
            launcher = self._playwright.webkit

        args: list[str] = []
        window_mode = (self._config.window_mode or 'default').lower()
        if not self._config.headless and self._config.browser_type == 'chromium':
            if window_mode == 'fullscreen':
                args.append('--start-fullscreen')
            elif window_mode == 'maximized':
                args.append('--start-maximized')

            screen = self._infer_screen_size()
            if screen and window_mode in ('fullscreen', 'maximized'):
                w, h = screen
                args.extend(['--window-position=0,0', f'--window-size={w},{h}'])

        self._browser = await launcher.launch(
            headless=self._config.headless,
            executable_path=self._config.browser_path,
            args=args or None,
        )
        self._launched_browser = True
        context = await self._browser.new_context(**self._context_kwargs())
        self._page = await context.new_page()
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
        return {
            'title': await self.page.title(),
            'url': self.page.url,
            'mode': 'embedded' if self._launched_browser else 'external',
            'cdp': self._connected_cdp_url or '',
        }
