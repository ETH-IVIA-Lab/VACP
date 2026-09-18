from __future__ import annotations

import pytest
from plain_mcp.runtime import PlainMcpRuntime, as_dict
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


async def test_sql_discovers_scoped_contract_and_executes_its_routing_identity() -> None:
    class Page:
        url = 'https://analysis.example'
        requests: list[object] = []
        names: list[str] = ['left.query']

        async def evaluate(self, expression: str, arg: object = None) -> object:
            if 'typeof' in expression:
                return True
            if 'getCapabilities' in expression:
                self.requests.append(as_dict(arg)['request'])
                return {
                    'graph': {
                        'actions': [{'name': name, 'operation': {'contract': 'vacp.data_sql'}} for name in self.names]
                    }
                }
            payload = as_dict(as_dict(arg)['payload'])
            self.requests.append(payload['name'])
            return {'callId': payload['callId'], 'ok': True, 'result': {'rows': [{'value': 1}]}}

    page = Page()
    runtime = PlainMcpRuntime(page)
    assert await runtime.sql('vacp://left/data', 'SELECT 1') == {'rows': [{'value': 1}]}
    assert page.requests == [{'refs': ['vacp://left/data']}, 'left.query']
    page.names = ['left.query', 'right.query']
    with pytest.raises(RuntimeError, match='found 2'):
        await runtime.sql('vacp://left/data', 'SELECT 1')
