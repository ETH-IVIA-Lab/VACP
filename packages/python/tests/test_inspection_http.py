import asyncio
import json
from pathlib import Path

from starlette.testclient import TestClient
from vacp import (
    ActionCall,
    ActionDescriptor,
    ActionResult,
    Availability,
    GraphFragment,
    Node,
    OperationSemantics,
    PreparedAction,
    ProviderComposer,
    ProviderObservation,
    SimpleProvider,
    SourceDescription,
)
from vacp.http import create_inspection_app

CALL_IDS = json.loads((Path(__file__).parents[2] / 'protocol/test/fixtures/call-id.json').read_text())


def test_http_client_observes_and_executes_one_host_owned_session() -> None:
    current = 0
    closed = False

    def observe() -> ProviderObservation:
        return ProviderObservation(
            str(current),
            '2026-09-18T12:00:00Z',
            GraphFragment(
                (
                    Node(
                        'vacp://value',
                        'Param',
                        'ConfigLayer',
                        availability=Availability(unavailable='Not initialized' if current == 0 else None),
                    ),
                ),
                (),
                (
                    ActionDescriptor(
                        'increment',
                        'Increment',
                        OperationSemantics('mutation', contract='counter.increment', affects=('vacp://value',)),
                    ),
                ),
            ),
            {'vacp://value': current},
        )

    def execute(call: ActionCall) -> ActionResult:
        nonlocal current
        current += 1
        return ActionResult(call.call_id, True, result=current)

    def close() -> None:
        nonlocal closed
        closed = True

    session = ProviderComposer(
        [
            SimpleProvider(
                SourceDescription('vacp-source://test', 'test', 'Test'),
                observe,
                lambda call, _context: PreparedAction(lambda: execute(call)),
                dispose=close,
            )
        ]
    )
    assert asyncio.run(session.observe()).graph.nodes == ()
    with TestClient(create_inspection_app(session)) as client:
        client.headers['X-VACP-Session'] = client.get('/api/vacp/session').json()['id']
        observation = client.get('/api/vacp/observation').json()
        assert observation['state'] == {'vacp://value': 0}
        assert observation['graph']['nodes'][0]['availability'] == {'unavailable': 'Not initialized'}
        assert observation['graph']['actions'][0]['operation']['contract'] == 'counter.increment'
        result = client.post('/api/vacp/operations', json={'callId': 'call', 'name': 'increment'})
        assert result.json() == {'callId': 'call', 'ok': True, 'result': 1}
        assert client.get('/api/vacp/observation').json()['revision']
        assert client.post('/api/vacp/operations', json={'name': ''}).status_code == 400
        client.headers['X-VACP-Session'] = 'a-different-session'
        assert client.post('/api/vacp/operations', json={'name': 'increment'}).status_code == 409
        assert current == 1
    assert not closed
    session.dispose()
    assert closed


def test_http_operations_pass_the_call_id_to_the_composer_as_written() -> None:
    session = ProviderComposer(
        [
            SimpleProvider(
                SourceDescription('vacp-source://test', 'test', 'Test'),
                lambda: ProviderObservation(
                    '0',
                    '2026-09-18T12:00:00Z',
                    GraphFragment((), (), (ActionDescriptor('run', 'Run', OperationSemantics('mutation')),)),
                    {},
                ),
                lambda call, _context: PreparedAction(lambda: ActionResult(call.call_id, True)),
            )
        ]
    )
    with TestClient(create_inspection_app(session)) as client:
        client.headers['X-VACP-Session'] = client.get('/api/vacp/session').json()['id']

        def call_id(supplied: dict[str, object]) -> object:
            return client.post('/api/vacp/operations', json={**supplied, 'name': 'run'}).json()['callId']

        for supplied in CALL_IDS['assigned']:
            first, second = call_id(supplied), call_id(supplied)
            assert first != second
            assert supplied.get('callId') not in (first, second)
        for supplied in CALL_IDS['kept']:
            assert call_id(supplied) == supplied['callId']
        for supplied in CALL_IDS['rejected']:
            assert client.post('/api/vacp/operations', json={**supplied, 'name': 'run'}).status_code == 400
    session.dispose()
