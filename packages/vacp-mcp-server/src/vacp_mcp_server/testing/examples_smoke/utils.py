from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any


def assert_(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def stable_json(value: Any) -> str:
    # Playwright can decode some JS values (e.g. Date) into Python datetime
    # objects. For smoke tests we only need a stable comparison string.
    return json.dumps(value, sort_keys=True, default=_json_default)


def param_values(snapshot: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    st = snapshot.get('state', {})
    if not isinstance(st, dict):
        return out
    for ref, val in st.items():
        if not isinstance(ref, str) or not isinstance(val, dict):
            continue
        if val.get('kind') != 'Param':
            continue
        v = val.get('value')
        if isinstance(v, (int, float)):
            out[ref] = float(v)
    return out
