from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import gemini_computer_use.main as main_module


def test_main_playwright(monkeypatch) -> None:
    monkeypatch.setenv('GEMINI_API_KEY', 'test_api_key')
    monkeypatch.setattr(
        sys,
        'argv',
        [
            'gemini-computer-use',
            '--query=test_query',
            '--env=playwright',
            '--initial-url=test_url',
            '--highlight-mouse',
            '--model=test_model',
        ],
    )

    env = MagicMock()
    env.__enter__.return_value = env

    with (
        patch('gemini_computer_use.main._maybe_load_dotenv'),
        patch('gemini_computer_use.main.init_tracing'),
        patch('gemini_computer_use.main.PlaywrightComputer', return_value=env) as mock_playwright_computer,
        patch('gemini_computer_use.main.BrowserAgent') as mock_browser_agent,
    ):
        main_module.main()

    mock_playwright_computer.assert_called_once_with(
        screen_size=main_module.PLAYWRIGHT_SCREEN_SIZE,
        initial_url='test_url',
        highlight_mouse=True,
    )
    mock_browser_agent.assert_called_once()
    mock_browser_agent.return_value.agent_loop.assert_called_once_with(max_steps=None)


def test_main_browserbase(monkeypatch) -> None:
    monkeypatch.setenv('GEMINI_API_KEY', 'test_api_key')
    monkeypatch.setenv('BROWSERBASE_API_KEY', 'bb_api_key')
    monkeypatch.setenv('BROWSERBASE_PROJECT_ID', 'bb_project_id')
    monkeypatch.setattr(
        sys,
        'argv',
        [
            'gemini-computer-use',
            '--query=test_query',
            '--env=browserbase',
            '--initial-url=test_url',
            '--model=test_model',
        ],
    )

    env = MagicMock()
    env.__enter__.return_value = env

    with (
        patch('gemini_computer_use.main._maybe_load_dotenv'),
        patch('gemini_computer_use.main.init_tracing'),
        patch('gemini_computer_use.main.BrowserbaseComputer', return_value=env) as mock_browserbase_computer,
        patch('gemini_computer_use.main.BrowserAgent') as mock_browser_agent,
    ):
        main_module.main()

    mock_browserbase_computer.assert_called_once_with(
        screen_size=main_module.PLAYWRIGHT_SCREEN_SIZE,
        initial_url='test_url',
    )
    mock_browser_agent.assert_called_once()
    mock_browser_agent.return_value.agent_loop.assert_called_once_with(max_steps=None)


def test_dotenv_only_gemini_api_key(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.chdir(tmp_path)

    (tmp_path / '.env').write_text('GEMINI_API_KEY=test_from_dotenv\n', encoding='utf-8')
    main_module._maybe_load_dotenv()

    assert os.environ['GEMINI_API_KEY'] == 'test_from_dotenv'
