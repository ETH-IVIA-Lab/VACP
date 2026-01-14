from __future__ import annotations

import importlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

_INSTRUMENTED = False


def init_tracing() -> bool:
    """Initialize Langfuse + OpenInference instrumentation for google-genai.

    Safe to call multiple times. It will:
    - Initialize a Langfuse client and verify auth.
    - If auth passes, instrument google-genai via OpenInference.
    - If anything fails, emit a warning (or info) and continue without tracing.
    """

    global _INSTRUMENTED

    try:
        langfuse_mod = importlib.import_module('langfuse')
        get_client = langfuse_mod.get_client
    except Exception as exc:  # pragma: no cover - depends on optional deps
        logger.info('Langfuse not available; tracing disabled (%s)', exc)
        return False

    try:
        langfuse_client: Any = get_client()
    except Exception:
        logger.exception('Failed to initialize Langfuse client; tracing disabled.')
        return False

    try:
        authed = bool(langfuse_client.auth_check())
    except Exception:
        logger.exception('Langfuse auth_check failed; tracing disabled.')
        return False

    if not authed:
        logger.warning('Langfuse auth failed; no traces will be collected. Check your Langfuse environment variables.')
        return False

    if _INSTRUMENTED:
        return True

    try:
        instr_mod = importlib.import_module('openinference.instrumentation.google_genai')
        instrumentor_cls = instr_mod.GoogleGenAIInstrumentor
        instrumentor_cls().instrument()
        _INSTRUMENTED = True
        logger.info('Tracing initialized (Langfuse + OpenInference google-genai).')
        return True
    except Exception:
        logger.exception('Failed to instrument google-genai; tracing disabled.')
        return False
