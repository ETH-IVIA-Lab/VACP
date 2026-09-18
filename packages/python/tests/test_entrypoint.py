from __future__ import annotations

import subprocess
import sys
from importlib.metadata import version


def test_module_entrypoint_exposes_vacp_help() -> None:
    result = subprocess.run([sys.executable, '-m', 'vacp', '--help'], capture_output=True, text=True, check=True)
    assert 'usage: vacp ' in result.stdout
    assert '--transport' in result.stdout
    assert result.stderr == ''


def test_module_version_matches_installed_distribution() -> None:
    result = subprocess.run([sys.executable, '-m', 'vacp', '--version'], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == f'vacp {version("vacp")}'
