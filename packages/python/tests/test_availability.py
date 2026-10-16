import asyncio
import json
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from vacp import (
    ActionCall,
    ActionContext,
    ActionDescriptor,
    ActionResult,
    Availability,
    GraphFragment,
    Node,
    Observation,
    OperationSemantics,
    PreparedAction,
    ProviderComposer,
    ProviderObservation,
    RefParameter,
    SimpleProvider,
    SourceDescription,
    resolve_availability,
)
from vacp.availability import AvailabilityError, require_action, resolve_observation

type Prepare = Callable[[ActionCall, ActionContext], PreparedAction]


def preparing(run: Callable[[ActionCall], ActionResult | Awaitable[ActionResult]]) -> Prepare:
    """A preparation with nothing to validate, whose execution runs `run` once."""
    return lambda call, _context: PreparedAction(lambda: run(call))


CASES = json.loads((Path(__file__).parents[2] / 'protocol/test/fixtures/availability.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=[case['name'] for case in CASES])
def test_shared_availability_contract(case: dict[str, object]) -> None:
    # JSON fixture is shared with the TypeScript protocol suite.
    nodes = case['nodes']
    actions = case['actions']
    assert isinstance(nodes, list) and isinstance(actions, list)
    graph = GraphFragment(
        tuple(
            Node(
                node['ref'],
                'View',
                'ViewLayer',
                availability=Availability(**node['availability']) if 'availability' in node else None,
            )
            for node in nodes
        ),
        (),
        tuple(
            ActionDescriptor(
                action['name'],
                action['name'],
                OperationSemantics(
                    action.get('operation', {}).get('kind', 'mutation'),
                    ref_parameters=tuple(
                        RefParameter(**parameter) for parameter in action.get('operation', {}).get('refParameters', ())
                    ),
                ),
                availability=Availability(**action['availability']) if 'availability' in action else None,
            )
            for action in actions
        ),
    )
    error = case.get('error')
    if isinstance(error, str):
        with pytest.raises(ValueError) as caught:
            resolve_availability(graph)
        assert str(caught.value) == error
        return
    resolved = resolve_observation(Observation('1', '', (), graph, {}, {}, {}))
    node_status, action_status = resolved.nodes, resolved.actions
    actual = {}
    for kind, statuses in [('nodes', node_status), ('actions', action_status)]:
        actual[kind] = {}
        for key, status in statuses.items():
            value: dict[str, object] = {'available': status.available, 'blockedBy': list(status.blocked_by)}
            if status.reason is not None:
                value['reason'] = status.reason
            actual[kind][key] = value
    assert actual == case['statuses']
    calls = case.get('calls', [])
    assert isinstance(calls, list)
    for invocation in calls:
        call = ActionCall('fixture', invocation['name'], invocation.get('params'))
        if 'error' in invocation:
            with pytest.raises(AvailabilityError) as failure:
                require_action(resolved, call)
            assert failure.value.details == invocation['error']
        else:
            require_action(resolved, call)


@pytest.mark.asyncio
async def test_discovery_and_inspection_share_one_execution_guard() -> None:
    ready = False
    mutations = 0

    def project() -> ProviderObservation:
        return ProviderObservation(
            str(ready),
            '',
            GraphFragment(
                (
                    Node(
                        'vacp://chart',
                        'Visualization',
                        'ViewLayer',
                        availability=Availability(unavailable=None if ready else 'Choose data'),
                    ),
                ),
                (),
                (
                    ActionDescriptor(
                        'click',
                        'Click bar',
                        OperationSemantics('mutation'),
                        availability=Availability(requires=('vacp://chart',)),
                    ),
                ),
            ),
            {'vacp://chart': 42},
        )

    def invoke(call: ActionCall) -> ActionResult:
        nonlocal mutations
        mutations += 1
        return ActionResult(call.call_id, True)

    composer = ProviderComposer(
        [SimpleProvider(SourceDescription('vacp-source://chart', 'chart', 'Chart'), project, preparing(invoke))]
    )
    try:
        assert (await composer.observe()).graph.actions == ()
        assert (await composer.observe()).state == {}
        assert len((await composer.inspect()).graph.actions) == 1
        assert not (await composer.execute(ActionCall('blocked', 'click'))).ok
        assert mutations == 0
        ready = True
        assert len((await composer.observe()).graph.actions) == 1
        assert (await composer.execute(ActionCall('ready', 'click'))).ok
        ready = False
        assert not (await composer.execute(ActionCall('stale', 'click'))).ok
        assert mutations == 1
    finally:
        composer.dispose()


@pytest.mark.asyncio
async def test_composer_owns_invocation_across_observation() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()

    async def project() -> ProviderObservation:
        entered.set()
        await release.wait()
        return ProviderObservation(
            '1',
            '',
            GraphFragment((), (), (ActionDescriptor('run', 'Run', OperationSemantics('query')),)),
            {},
        )

    composer = ProviderComposer(
        [
            SimpleProvider(
                SourceDescription('vacp-source://input', 'test', 'Input'),
                project,
                preparing(lambda call: ActionResult(call.call_id, True, result=call.params)),
            ),
        ]
    )
    try:
        params = {'value': 'original'}
        executing = asyncio.create_task(composer.execute(ActionCall('owned', 'run', params)))
        await entered.wait()
        params['value'] = 'changed'
        release.set()
        assert (await executing).result == {'value': 'original'}
    finally:
        release.set()
        composer.dispose()
