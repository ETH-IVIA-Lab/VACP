from __future__ import annotations

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
EVALUATION_ROOT = PACKAGE_ROOT.parent
DEFAULT_RUNS_ROOT = EVALUATION_ROOT / 'agent-arena' / '.agent-arena' / 'runs'
DEFAULT_PROMPT_FILE = PACKAGE_ROOT / 'workbench' / 'ANALYSISPROMPT.md'
ENV_FILE = PACKAGE_ROOT / '.env'
