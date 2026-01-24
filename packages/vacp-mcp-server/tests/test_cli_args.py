from __future__ import annotations

from vacp_mcp_server.main import parse_args


def test_parse_args_defaults_to_http_transport() -> None:
    args = parse_args([])
    assert args.transport == 'http'
    assert args.show_banner is False
    assert args.mcp_log_level is None


def test_parse_args_accepts_stdio_transport() -> None:
    args = parse_args(['--transport', 'stdio'])
    assert args.transport == 'stdio'


def test_parse_args_stdio_alias_overrides_transport() -> None:
    args = parse_args(['--transport', 'http', '--stdio'])
    assert args.transport == 'stdio'


def test_parse_args_stdio_banner_and_log_level() -> None:
    args = parse_args(['--transport', 'stdio', '--show-banner', '--mcp-log-level', 'debug'])
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
