from __future__ import annotations

import importlib
import logging
from types import SimpleNamespace

import pytest
from gemini_computer_use.tracing import init_tracing


def test_init_tracing_auth_failed_warns(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    def fake_import(name: str):
        if name == 'langfuse':
            return SimpleNamespace(get_client=lambda: SimpleNamespace(auth_check=lambda: False))
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(importlib, 'import_module', fake_import)

    with caplog.at_level(logging.INFO):
        ok = init_tracing()

    assert ok is False
    assert 'Langfuse auth failed' in caplog.text


def test_init_tracing_instruments_once(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    class FakeInstrumentor:
        def instrument(self) -> None:
            calls.append('instrument')

    def fake_import(name: str):
        if name == 'langfuse':
            return SimpleNamespace(get_client=lambda: SimpleNamespace(auth_check=lambda: True))
        if name == 'openinference.instrumentation.google_genai':
            return SimpleNamespace(GoogleGenAIInstrumentor=FakeInstrumentor)
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(importlib, 'import_module', fake_import)

    assert init_tracing() is True
    assert init_tracing() is True
    assert calls == ['instrument']
