from __future__ import annotations

from plain_mcp.sql import with_criteria


def test_with_criteria_drops_missing_values_and_preserves_falsey_filters() -> None:
    assert with_criteria(
        {'rows': []},
        {'category': None, 'minCount': 0, 'enabled': False, 'aggregate': 'count_by_weather'},
    ) == {
        'rows': [],
        'criteria': {'minCount': 0, 'enabled': False, 'aggregate': 'count_by_weather'},
    }
