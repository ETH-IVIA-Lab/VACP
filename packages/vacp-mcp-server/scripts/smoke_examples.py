from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    scripts_dir = Path(__file__).resolve().parent
    pkg_root = scripts_dir.parent
    src_dir = pkg_root / 'src'
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))

    # `.../vacp/packages/vacp-mcp-server/scripts/smoke_examples.py` -> `.../vacp`
    vacp_root = pkg_root.parents[1]
    artifacts_dir = vacp_root / '.artifacts' / 'examples-smoke'

    from vacp_mcp_server.testing.examples_smoke.runner import run_examples_smoke_sync

    return run_examples_smoke_sync(vacp_root=vacp_root, artifacts_dir=artifacts_dir)


if __name__ == '__main__':
    raise SystemExit(main())
