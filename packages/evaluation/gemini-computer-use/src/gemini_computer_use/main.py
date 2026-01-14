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

import argparse
import os
from pathlib import Path

from .agent import BrowserAgent
from .computers import BrowserbaseComputer, PlaywrightComputer
from .tracing import init_tracing

PLAYWRIGHT_SCREEN_SIZE: tuple[int, int] = (1440, 900)


def _maybe_load_dotenv() -> None:
    # Keep behavior close to the upstream reference (which relies on environment variables),
    # but support a local `.env` file for convenience in this repo.
    dotenv_candidates: list[Path] = []

    cwd = Path.cwd()
    dotenv_candidates.append(cwd / '.env')
    dotenv_candidates.extend(parent / '.env' for parent in cwd.parents)

    # When running from a monorepo root, the `.env` may live in the package directory.
    package_root = Path(__file__).resolve().parents[2]
    dotenv_candidates.append(package_root / '.env')

    for dotenv_path in dotenv_candidates:
        if not dotenv_path.is_file():
            continue

        for raw_line in dotenv_path.read_text(encoding='utf-8').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line.removeprefix('export ').lstrip()
            if '=' not in line:
                continue

            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip().strip('\'"')

            if key and key not in os.environ:
                os.environ[key] = value
        break


def main() -> int:
    _maybe_load_dotenv()
    init_tracing()

    parser = argparse.ArgumentParser(description='Run the browser agent with a query.')
    parser.add_argument(
        '--query',
        type=str,
        required=True,
        help='The query for the browser agent to execute.',
    )

    parser.add_argument(
        '--env',
        type=str,
        choices=('playwright', 'browserbase'),
        default='playwright',
        help='The computer use environment to use.',
    )
    parser.add_argument(
        '--initial-url',
        '--initial_url',
        type=str,
        default='https://www.google.com',
        help='The inital URL loaded for the computer.',
    )
    parser.add_argument(
        '--highlight-mouse',
        '--highlight_mouse',
        action='store_true',
        default=False,
        help='If possible, highlight the location of the mouse.',
    )
    parser.add_argument(
        '--model',
        default='gemini-2.5-computer-use-preview-10-2025',
        help='Set which main model to use.',
    )
    parser.add_argument(
        '--auto-confirm',
        '--auto_confirm',
        action='store_true',
        default=False,
        help='If set, never prompt for safety confirmations; proceed automatically.',
    )
    parser.add_argument(
        '--max-steps',
        '--max_steps',
        type=int,
        default=None,
        help='Maximum number of model steps before stopping. Set to 0 or negative to run indefinitely.',
    )
    args = parser.parse_args()

    if args.env == 'playwright':
        env = PlaywrightComputer(
            screen_size=PLAYWRIGHT_SCREEN_SIZE,
            initial_url=args.initial_url,
            highlight_mouse=args.highlight_mouse,
        )
    elif args.env == 'browserbase':
        env = BrowserbaseComputer(
            screen_size=PLAYWRIGHT_SCREEN_SIZE,
            initial_url=args.initial_url,
        )
    else:
        raise ValueError('Unknown environment: ', args.env)

    if os.environ.get('USE_VERTEXAI', '0').lower() not in ('true', '1') and not os.environ.get('GEMINI_API_KEY'):
        parser.error('Missing `GEMINI_API_KEY` (set env var or add to `.env`).')

    if args.env == 'browserbase':
        missing = [k for k in ('BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID') if not os.environ.get(k)]
        if missing:
            parser.error(f'Missing required environment variables for browserbase: {", ".join(missing)}')

    with env as browser_computer:
        agent = BrowserAgent(
            browser_computer=browser_computer,
            query=args.query,
            model_name=args.model,
            auto_confirm_safety=args.auto_confirm
            or os.environ.get('GEMINI_COMPUTER_USE_AUTO_CONFIRM', '').lower() in ('true', '1'),
        )
        max_steps = args.max_steps
        if max_steps is not None and max_steps <= 0:
            max_steps = None
        elif max_steps is None:
            env_max_steps = os.environ.get('GEMINI_COMPUTER_USE_MAX_STEPS')
            if env_max_steps:
                try:
                    parsed = int(env_max_steps)
                except ValueError:
                    parser.error('Invalid GEMINI_COMPUTER_USE_MAX_STEPS: must be an integer.')
                if parsed > 0:
                    max_steps = parsed

        agent.agent_loop(max_steps=max_steps)
    return 0
