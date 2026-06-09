from __future__ import annotations

from plain_mcp.sql import data_response


def test_data_response_drops_internal_fields_and_preserves_falsey_filters() -> None:
    assert data_response(
        {
            'format': 'json',
            'resolvedSql': 'SELECT * FROM internal_table',
            'rows': [{'weather': 'rain', 'count': 3, '__total_count': 12}],
            'truncated': True,
        },
        {'category': None, 'minCount': 0, 'enabled': False, 'aggregate': 'count_by_weather'},
        note='Grouped weather counts.',
    ) == {
        'rows': [{'weather': 'rain', 'count': 3}],
        'columns': ['weather', 'count'],
        'rowCount': 1,
        'totalRows': 12,
        'filters': {'minCount': 0, 'enabled': False, 'aggregate': 'count_by_weather'},
        'truncated': True,
        'note': 'Grouped weather counts.',
    }
