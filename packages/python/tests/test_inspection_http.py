import asyncio

from starlette.testclient import TestClient
from vacp import (
    Availability,
    GraphFragment,
    Invocation,
    InvocationResult,
    Node,
    OperationDescriptor,
    OperationSemantics,
    ProviderComposer,
    ProviderObservation,
    SimpleProvider,
    SourceDescription,
)
from vacp.http import create_inspection_app


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
                    OperationDescriptor(
                        'increment',
                        'Increment',
                        OperationSemantics('mutation', contract='counter.increment', affects=('vacp://value',)),
                    ),
                ),
            ),
            {'vacp://value': current},
        )

    def execute(call: Invocation) -> InvocationResult:
        nonlocal current
        current += 1
        return InvocationResult(call.call_id, True, result=current)

    def close() -> None:
        nonlocal closed
        closed = True

    session = ProviderComposer(
        [SimpleProvider(SourceDescription('vacp-source://test', 'test', 'Test'), observe, execute, close=close)]
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
        assert client.post('/api/vacp/operations', json={'callId': 'stale', 'name': 'increment'}).status_code == 409
        assert current == 1
    assert not closed
    session.dispose()
    assert closed
