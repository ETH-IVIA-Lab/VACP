from __future__ import annotations

from vacp.main import parse_args


def test_parse_args_defaults_to_stdio_in_a_normal_window() -> None:
    args = parse_args([])
    assert args.transport == 'stdio'
    assert args.window_mode == 'default'
    assert args.show_banner is False
    assert args.mcp_log_level is None


def test_parse_args_accepts_http_transport_and_window_modes() -> None:
    args = parse_args(['--transport', 'http', '--window-mode', 'fullscreen'])
    assert args.transport == 'http'
    assert args.window_mode == 'fullscreen'


def test_parse_args_stdio_banner_and_log_level() -> None:
    args = parse_args(['--show-banner', '--mcp-log-level', 'debug'])
    assert args.transport == 'stdio'
    assert args.show_banner is True
    assert args.mcp_log_level == 'debug'


def test_parse_args_headless() -> None:
    args = parse_args(['--headless'])
    assert args.headless is True


def test_parse_args_browser_tools_flag_defaults_off() -> None:
    args = parse_args([])
    assert args.enable_browser_tools is False


def test_parse_args_browser_tools_flag_enables() -> None:
    args = parse_args(['--enable-browser-tools'])
    assert args.enable_browser_tools is True


def test_parse_args_startup_wait_defaults() -> None:
    args = parse_args([])
    assert args.startup_wait_for_bridge is True
    assert args.startup_ready_timeout_ms == 30_000
    assert args.startup_wait_for_selector is None
    assert args.startup_selector_timeout_ms == 30_000
    assert args.startup_selector_state == 'visible'


def test_parse_args_startup_wait_options() -> None:
    args = parse_args(
        [
            '--startup-ready-timeout-ms',
            '45000',
            '--startup-wait-for-selector',
            '#chart svg',
            '--startup-selector-timeout-ms',
            '12000',
            '--startup-selector-state',
            'attached',
        ]
    )
    assert args.startup_wait_for_bridge is True
    assert args.startup_ready_timeout_ms == 45_000
    assert args.startup_wait_for_selector == '#chart svg'
    assert args.startup_selector_timeout_ms == 12_000
    assert args.startup_selector_state == 'attached'


def test_parse_args_turns_the_bridge_wait_off() -> None:
    assert parse_args(['--no-startup-wait-for-bridge']).startup_wait_for_bridge is False
