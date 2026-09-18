from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from arena_analysis.paths import ENV_FILE

DEFAULT_BASE_URL = 'http://localhost:8317/v1'
DEFAULT_MODEL = 'gpt-5.4'
DEFAULT_API_KEY = 'default'


@dataclass(frozen=True, slots=True)
class Env:
    path: Path
    loaded: bool
    keys: tuple[str, ...]


def load(path: Path = ENV_FILE) -> Env:
    loaded = path.exists()
    if loaded:
        load_dotenv(path, override=False)
    keys = tuple(
        key
        for key in ('MODEL', 'OPENAI_BASE', 'OPENAI_BASE_URL', 'OPENAI_API_KEY')
        if os.environ.get(key) not in (None, '')
    )
    return Env(path=path, loaded=loaded, keys=keys)


def base_url() -> str:
    return os.environ.get('OPENAI_BASE') or os.environ.get('OPENAI_BASE_URL') or DEFAULT_BASE_URL


def model() -> str:
    return os.environ.get('MODEL') or DEFAULT_MODEL


def api_key() -> str:
    return os.environ.get('OPENAI_API_KEY') or DEFAULT_API_KEY
