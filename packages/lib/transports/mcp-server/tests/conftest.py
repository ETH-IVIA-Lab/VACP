from __future__ import annotations

import sys
from pathlib import Path

import pytest


@pytest.fixture(scope='session', autouse=True)
def _ensure_src_on_path() -> None:
    pkg_root = Path(__file__).resolve().parents[1]
    src_dir = pkg_root / 'src'
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))
