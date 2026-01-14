from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from gemini_computer_use.agent import BrowserAgent, multiply_numbers
from gemini_computer_use.computers import EnvState
from google.genai import types


@pytest.fixture
def agent(monkeypatch: pytest.MonkeyPatch) -> BrowserAgent:
    monkeypatch.setenv('GEMINI_API_KEY', 'test_api_key')
    mock_browser_computer = MagicMock()
    mock_browser_computer.screen_size.return_value = (1000, 1000)

    agent = BrowserAgent(
        browser_computer=mock_browser_computer,
        query='test query',
        model_name='test_model',
        verbose=False,
        auto_confirm_safety=False,
    )
    # Avoid any accidental network calls in tests.
    agent._client = MagicMock()
    return agent


def test_multiply_numbers() -> None:
    assert multiply_numbers(2, 3) == {'result': 6}


def test_handle_action_open_web_browser(agent: BrowserAgent) -> None:
    action = types.FunctionCall(name='open_web_browser', args={})
    agent.handle_action(action)
    agent._browser_computer.open_web_browser.assert_called_once()


def test_handle_action_click_at(agent: BrowserAgent) -> None:
    action = types.FunctionCall(name='click_at', args={'x': 100, 'y': 200})
    agent.handle_action(action)
    agent._browser_computer.click_at.assert_called_once_with(x=100, y=200)


def test_handle_action_type_text_at(agent: BrowserAgent) -> None:
    action = types.FunctionCall(name='type_text_at', args={'x': 100, 'y': 200, 'text': 'hello'})
    agent.handle_action(action)
    agent._browser_computer.type_text_at.assert_called_once_with(
        x=100,
        y=200,
        text='hello',
        press_enter=False,
        clear_before_typing=True,
    )


def test_handle_action_scroll_document(agent: BrowserAgent) -> None:
    action = types.FunctionCall(name='scroll_document', args={'direction': 'down'})
    agent.handle_action(action)
    agent._browser_computer.scroll_document.assert_called_once_with('down')


def test_handle_action_navigate(agent: BrowserAgent) -> None:
    action = types.FunctionCall(name='navigate', args={'url': 'https://example.com'})
    agent.handle_action(action)
    agent._browser_computer.navigate.assert_called_once_with('https://example.com')


def test_handle_action_unknown_function(agent: BrowserAgent) -> None:
    action = types.FunctionCall(name='unknown_function', args={})
    with pytest.raises(ValueError):
        agent.handle_action(action)


def test_denormalize_x(agent: BrowserAgent) -> None:
    assert agent.denormalize_x(500) == 500


def test_denormalize_y(agent: BrowserAgent) -> None:
    assert agent.denormalize_y(500) == 500


def test_run_one_iteration_no_function_calls(agent: BrowserAgent) -> None:
    mock_response = MagicMock()
    mock_candidate = MagicMock()
    mock_candidate.content.parts = [types.Part(text='some reasoning')]
    mock_response.candidates = [mock_candidate]

    with patch.object(agent, 'get_model_response', return_value=mock_response):
        result = agent.run_one_iteration()

    assert result == 'COMPLETE'
    assert len(agent._contents) == 2
    assert agent._contents[1] == mock_candidate.content


def test_run_one_iteration_with_function_call(agent: BrowserAgent) -> None:
    mock_response = MagicMock()
    mock_candidate = MagicMock()
    function_call = types.FunctionCall(name='navigate', args={'url': 'https://example.com'})
    mock_candidate.content.parts = [types.Part(function_call=function_call)]
    mock_response.candidates = [mock_candidate]

    mock_env_state = EnvState(screenshot=b'screenshot', url='https://example.com')

    with (
        patch.object(agent, 'get_model_response', return_value=mock_response),
        patch.object(agent, 'handle_action', return_value=mock_env_state) as mock_handle_action,
    ):
        result = agent.run_one_iteration()

    assert result == 'CONTINUE'
    mock_handle_action.assert_called_once_with(function_call)
    assert len(agent._contents) == 3


def test_run_one_iteration_safety_auto_confirm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('GEMINI_API_KEY', 'test_api_key')

    mock_browser_computer = MagicMock()
    mock_browser_computer.screen_size.return_value = (1000, 1000)
    agent = BrowserAgent(
        browser_computer=mock_browser_computer,
        query='test query',
        model_name='test_model',
        verbose=False,
        auto_confirm_safety=True,
    )
    agent._client = MagicMock()

    mock_response = MagicMock()
    mock_candidate = MagicMock()
    function_call = types.FunctionCall(
        name='navigate',
        args={
            'url': 'https://example.com',
            'safety_decision': {'decision': 'require_confirmation', 'explanation': 'test'},
        },
    )
    mock_candidate.content.parts = [types.Part(function_call=function_call)]
    mock_response.candidates = [mock_candidate]

    mock_env_state = EnvState(screenshot=b'screenshot', url='https://example.com')

    def fail_input(_: str) -> str:
        raise AssertionError('input() should not be called when auto_confirm_safety=True')

    monkeypatch.setattr('builtins.input', fail_input)

    with (
        patch.object(agent, 'get_model_response', return_value=mock_response),
        patch.object(agent, 'handle_action', return_value=mock_env_state) as mock_handle_action,
    ):
        result = agent.run_one_iteration()

    assert result == 'CONTINUE'
    mock_handle_action.assert_called_once()


def test_agent_loop_respects_max_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('GEMINI_API_KEY', 'test_api_key')

    mock_browser_computer = MagicMock()
    mock_browser_computer.screen_size.return_value = (1000, 1000)
    agent = BrowserAgent(
        browser_computer=mock_browser_computer,
        query='test query',
        model_name='test_model',
        verbose=False,
    )
    agent._client = MagicMock()

    with patch.object(agent, 'run_one_iteration', return_value='CONTINUE') as mock_run:
        agent.agent_loop(max_steps=2)

    assert mock_run.call_count == 2
    assert agent.final_reasoning == 'Stopped after reaching max_steps=2.'
