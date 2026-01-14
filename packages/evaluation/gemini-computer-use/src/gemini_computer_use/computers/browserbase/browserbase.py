# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import os

import browserbase
import termcolor
from browserbase.types import session_create_params, session_create_response
from playwright.sync_api import Playwright, sync_playwright

from ..playwright.playwright import PlaywrightComputer


class BrowserbaseComputer(PlaywrightComputer):
    def __init__(
        self,
        screen_size: tuple[int, int],
        initial_url: str = 'https://www.google.com',
    ):
        super().__init__(screen_size, initial_url)
        self._browserbase: browserbase.Browserbase | None = None
        self._session: session_create_response.SessionCreateResponse | None = None
        self._playwright: Playwright | None = None

    def __enter__(self):
        print('Creating session...')

        self._playwright = sync_playwright().start()
        self._browserbase = browserbase.Browserbase(api_key=os.environ['BROWSERBASE_API_KEY'])

        browser_settings: session_create_params.BrowserSettings = {
            'fingerprint': {
                'screen': {
                    'max_width': 1920,
                    'max_height': 1080,
                    'min_width': 1024,
                    'min_height': 768,
                },
            },
            'viewport': {
                'width': self._screen_size[0],
                'height': self._screen_size[1],
            },
        }

        self._session = self._browserbase.sessions.create(
            project_id=os.environ['BROWSERBASE_PROJECT_ID'],
            browser_settings=browser_settings,
        )

        assert self._playwright is not None
        assert self._session is not None
        self._browser = self._playwright.chromium.connect_over_cdp(self._session.connect_url)
        self._context = self._browser.contexts[0]
        self._page = self._context.pages[0]
        self._page.goto(self._initial_url)

        self._context.on('page', self._handle_new_page)

        assert self._session is not None
        termcolor.cprint(
            f'Session started at https://browserbase.com/sessions/{self._session.id}',
            color='green',
            attrs=['bold'],
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._page:
            self._page.close()

        if self._context:
            self._context.close()

        if self._browser:
            self._browser.close()

        if self._playwright:
            self._playwright.stop()
