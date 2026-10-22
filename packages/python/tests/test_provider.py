from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeAlias, cast

import pytest
from vacp import (
    ActionCall,
    ActionContext,
    ActionDescriptor,
    ActionRequest,
    ActionResult,
    Edge,
    Freshness,
    GraphFragment,
    Node,
    OperationResultDescriptor,
    OperationSemantics,
    PreparedAction,
    ProviderComposer,
    ProviderObservation,
    SimpleProvider,
    SourceDescription,
    as_dict,
)

Prepare: TypeAlias = Callable[[ActionCall, ActionContext], PreparedAction]

CALL_IDS = json.loads((Path(__file__).parents[2] / 'protocol/test/fixtures/call-id.json').read_text())


def preparing(run: Callable[[ActionCall], ActionResult | Awaitable[ActionResult]]) -> Prepare:
    """A preparation with nothing to validate, whose execution runs `run` once."""
    return lambda call, _context: PreparedAction(lambda: run(call))


def record(value: object) -> Mapping[str, object]:
    assert isinstance(value, Mapping)
    return cast(Mapping[str, object], value)


def source(source_id: str, ref: str, operation: str, *, edge: Edge | None = None) -> SimpleProvider:
    description = SourceDescription(source_id, 'test', source_id)

    def project() -> ProviderObservation:
        return ProviderObservation(
            revision='1',
            observed_at=datetime.now(timezone.utc).isoformat(),
            graph=GraphFragment(
                nodes=(Node(ref, 'TestOutput', 'AnalysisLayer'),),
                edges=(edge,) if edge else (),
                actions=(
                    ActionDescriptor(
                        operation,
                        operation,
                        OperationSemantics(
                            'evaluation',
                            contract='analysis.evaluate',
                            affects=(ref,),
                            results=(OperationResultDescriptor('visualization', ref=ref),),
                        ),
                    ),
                ),
            ),
            state={ref: {'value': source_id}},
            freshness={ref: Freshness('current', output_revision='1')},
        )

    return SimpleProvider(
        description, project, preparing(lambda call: ActionResult(call.call_id, True, result=source_id))
    )


@pytest.mark.asyncio
async def test_composition_preserves_ownership_relations_freshness_and_routing() -> None:
    widget_ref = 'vacp://widget/filter'
    chart_ref = 'vacp://notebook/chart'
    composer = ProviderComposer(
        [
            source('vacp-source://widget', widget_ref, 'widget.update'),
            source(
                'vacp-source://notebook',
                chart_ref,
                'notebook.evaluate',
                edge=Edge(widget_ref, chart_ref, 'controls'),
            ),
        ]
    )
    try:
        observation = await composer.observe()
        assert observation.node_owners == {
            widget_ref: 'vacp-source://widget',
            chart_ref: 'vacp-source://notebook',
        }
        assert observation.graph.edges == (Edge(widget_ref, chart_ref, 'controls'),)
        assert observation.freshness and observation.freshness[chart_ref].status == 'current'
        wire = as_dict(observation)
        graph = record(wire['graph'])
        ownership = record(graph['ownership'])
        assert record(ownership['actions'])['notebook.evaluate'] == 'vacp-source://notebook'
        actions = graph['actions']
        assert isinstance(actions, list)
        semantics = record(record(actions[1])['operation'])
        assert semantics['contract'] == 'analysis.evaluate'
        results = semantics['results']
        assert isinstance(results, list)
        assert results[0] == {
            'role': 'visualization',
            'ref': chart_ref,
        }
        assert await composer.execute(ActionRequest('notebook.evaluate', call_id='run')) == ActionResult(
            'run', True, result='vacp-source://notebook'
        )
    finally:
        composer.dispose()


@pytest.mark.asyncio
async def test_composition_rejects_competing_node_owners() -> None:
    composer = ProviderComposer(
        [
            source('vacp-source://one', 'vacp://shared', 'one'),
            source('vacp-source://two', 'vacp://shared', 'two'),
        ]
    )
    with pytest.raises(ValueError, match='owned by both'):
        await composer.observe()


@pytest.mark.asyncio
async def test_composer_routes_a_changed_catalog_and_disposes_once() -> None:
    current = source('vacp-source://dynamic', 'vacp://dynamic', 'first')
    close_count = 0

    def close() -> None:
        nonlocal close_count
        close_count += 1

    current.dispose = close
    composer = ProviderComposer([current])
    await composer.observe()
    current.observe = source('vacp-source://dynamic', 'vacp://dynamic', 'second').observe
    result = await composer.execute(ActionRequest('second'))
    assert result.ok
    assert not (await composer.execute(ActionRequest('first'))).ok
    composer.dispose()
    composer.dispose()
    assert close_count == 1
    with pytest.raises(RuntimeError, match='disposed'):
        await composer.observe()


@pytest.mark.asyncio
async def test_disposal_rejects_pending_observations_before_operation_dispatch() -> None:
    current = source('source', 'node', 'run')
    project = current.observe
    entered, release = asyncio.Event(), asyncio.Event()
    invoked = False

    async def observe() -> ProviderObservation:
        entered.set()
        await release.wait()
        result = project()
        assert isinstance(result, ProviderObservation)
        return result

    def invoke(call: ActionCall) -> ActionResult:
        nonlocal invoked
        invoked = True
        return ActionResult(call.call_id, True)

    current.observe, current.prepare = observe, preparing(invoke)
    composer = ProviderComposer([current])
    pending = asyncio.create_task(composer.execute(ActionRequest('run')))
    await entered.wait()
    composer.dispose()
    release.set()
    with pytest.raises(RuntimeError, match='disposed'):
        await pending
    assert not invoked


@pytest.mark.asyncio
async def test_disposal_during_preparation_prevents_execution() -> None:
    current = source('source', 'node', 'run')
    entered, release = asyncio.Event(), asyncio.Event()
    executed = False

    def run(call: ActionCall) -> ActionResult:
        nonlocal executed
        executed = True
        return ActionResult(call.call_id, True)

    async def prepare(call: ActionCall, _context: ActionContext) -> PreparedAction:
        entered.set()
        await release.wait()
        return PreparedAction(lambda: run(call))

    current.prepare = prepare
    composer = ProviderComposer([current])
    pending = asyncio.create_task(composer.execute(ActionRequest('run')))
    await entered.wait()
    composer.dispose()
    release.set()
    with pytest.raises(RuntimeError, match='disposed'):
        await pending
    assert not executed


@pytest.mark.asyncio
async def test_a_completed_result_stands_when_the_composer_is_disposed_during_execution() -> None:
    current = source('source', 'node', 'run')
    entered, release = asyncio.Event(), asyncio.Event()

    async def run(call: ActionCall) -> ActionResult:
        entered.set()
        await release.wait()
        return ActionResult(call.call_id, True, result='applied')

    current.prepare = preparing(run)
    composer = ProviderComposer([current])
    pending = asyncio.create_task(composer.execute(ActionRequest('run', call_id='call')))
    await entered.wait()
    composer.dispose()
    release.set()
    assert await pending == ActionResult('call', True, result='applied')


@pytest.mark.asyncio
async def test_composer_assigns_a_missing_or_blank_call_id_and_keeps_any_other_as_written() -> None:
    current = source('source', 'node', 'run')
    prepared: list[str] = []

    def invoke(call: ActionCall) -> ActionResult:
        prepared.append(call.call_id)
        return ActionResult(call.call_id, True)

    current.prepare = preparing(invoke)
    composer = ProviderComposer([current])
    try:
        ids: list[str] = []
        for supplied in CALL_IDS['assigned']:
            request = ActionRequest('run', call_id=supplied.get('callId'))
            first = await composer.execute(request)
            second = await composer.execute(request)
            assert first.call_id != second.call_id
            assert supplied.get('callId') not in (first.call_id, second.call_id)
            ids += [first.call_id, second.call_id]
        for supplied in CALL_IDS['kept']:
            result = await composer.execute(ActionRequest('run', call_id=supplied['callId']))
            assert result.call_id == supplied['callId']
            ids.append(result.call_id)
        assert prepared == ids
    finally:
        composer.dispose()


@pytest.mark.asyncio
async def test_a_result_carries_the_call_id_even_when_the_provider_answers_under_another() -> None:
    current = source('source', 'node', 'run')
    current.prepare = preparing(lambda call: ActionResult('provider-chosen', True))
    composer = ProviderComposer([current])
    try:
        assert (await composer.execute(ActionRequest('run', call_id='mine'))).call_id == 'mine'
        assert (await composer.execute(ActionRequest('run'))).call_id != 'provider-chosen'
    finally:
        composer.dispose()


@pytest.mark.asyncio
async def test_composer_rejects_a_call_id_that_is_not_a_string() -> None:
    current = source('source', 'node', 'run')
    prepared: list[str] = []

    def invoke(call: ActionCall) -> ActionResult:
        prepared.append(call.call_id)
        return ActionResult(call.call_id, True)

    current.prepare = preparing(invoke)
    composer = ProviderComposer([current])
    try:
        for supplied in CALL_IDS['rejected']:
            with pytest.raises(TypeError, match='call_id must be a string'):
                await composer.execute(ActionRequest('run', call_id=supplied['callId']))
        assert prepared == []
    finally:
        composer.dispose()


@pytest.mark.asyncio
async def test_a_prepared_action_runs_once() -> None:
    runs: list[str] = []
    prepared = PreparedAction(lambda: runs.append('ran') or ActionResult('call', True))
    assert (await prepared.execute()).ok
    with pytest.raises(RuntimeError, match='already been executed'):
        await prepared.execute()
    assert runs == ['ran']


@pytest.mark.asyncio
async def test_a_failed_preparation_is_a_failure_result_before_any_effect() -> None:
    current = source('source', 'node', 'run')

    def prepare(_call: ActionCall, _context: ActionContext) -> PreparedAction:
        raise ValueError('Expected a value')

    current.prepare = prepare
    composer = ProviderComposer([current])
    try:
        assert await composer.execute(ActionRequest('run', call_id='call')) == ActionResult(
            'call', False, error={'message': 'Expected a value'}
        )
    finally:
        composer.dispose()


@pytest.mark.asyncio
async def test_observations_are_captured_once_and_isolated_from_providers_and_consumers() -> None:
    shared: dict[str, object] = {'values': [1, 2]}
    current = source('source', 'vacp://node', 'run')

    def observe() -> ProviderObservation:
        return ProviderObservation(
            '1', '', GraphFragment((Node('vacp://node', 'Param', 'ConfigLayer'),), (), ()), {'vacp://node': shared}
        )

    current.observe = observe
    composer = ProviderComposer([current])
    try:
        first = await composer.observe()
        values = first.state['vacp://node']
        assert isinstance(values, dict)
        values['values'].append('consumer')
        shared['values'] = ['provider']
        assert first.state['vacp://node'] == {'values': [1, 2, 'consumer']}
        assert (await composer.inspect()).state['vacp://node'] == {'values': ['provider']}
        assert shared == {'values': ['provider']}
    finally:
        composer.dispose()


def test_failed_construction_releases_acquired_subscriptions() -> None:
    attached: list[Callable[[], None]] = []

    def subscribe(callback: Callable[[], None]) -> Callable[[], None]:
        attached.append(callback)
        return lambda: attached.remove(callback)

    def fail(_callback: Callable[[], None]) -> Callable[[], None]:
        raise RuntimeError('Cannot subscribe')

    first, second = source('first', 'a', 'a'), source('second', 'b', 'b')
    first.subscribe, second.subscribe = subscribe, fail
    with pytest.raises(RuntimeError, match='Cannot subscribe'):
        ProviderComposer([first, second])
    assert not attached


def test_disposal_releases_every_source_even_when_cleanup_fails() -> None:
    released: list[str] = []

    def failing_cleanup() -> None:
        released.append('failed cleanup')
        raise RuntimeError('Cleanup failed')

    first, second = source('first', 'a', 'a'), source('second', 'b', 'b')
    first.subscribe = lambda _callback: failing_cleanup
    first.dispose = failing_cleanup
    second.subscribe = lambda _callback: lambda: released.append('second subscription')
    second.dispose = lambda: released.append('second provider')
    composer = ProviderComposer([first, second])
    with pytest.raises(RuntimeError, match='Cleanup failed'):
        composer.dispose()
    assert sorted(released) == ['failed cleanup', 'failed cleanup', 'second provider', 'second subscription']
    composer.dispose()
    with pytest.raises(RuntimeError, match='disposed'):
        composer.subscribe(lambda: None)


@pytest.mark.asyncio
async def test_subscriber_failure_does_not_change_operation_result_or_skip_other_subscribers(
    caplog: pytest.LogCaptureFixture,
) -> None:
    callbacks: list[Callable[[], None]] = []
    notified: list[str] = []
    current = source('source', 'node', 'run')

    def subscribe(callback: Callable[[], None]) -> Callable[[], None]:
        callbacks.append(callback)
        return lambda: callbacks.remove(callback)

    def invoke(call: ActionCall) -> ActionResult:
        for callback in callbacks:
            callback()
        return ActionResult(call.call_id, True)

    def fail() -> None:
        raise RuntimeError('Broken viewer')

    current.subscribe, current.prepare = subscribe, preparing(invoke)
    composer = ProviderComposer([current])
    composer.subscribe(fail)
    composer.subscribe(lambda: notified.append('changed'))
    try:
        assert (await composer.execute(ActionRequest('run'))).ok
        assert notified == ['changed']
        assert 'Broken viewer' in caplog.text
    finally:
        composer.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('supplied', [False, True])
async def test_composer_preserves_parameter_presence(supplied: bool) -> None:
    provider = source('vacp-source://params', 'vacp://params', 'reset')
    seen: list[bool] = []

    def prepare(call: ActionCall, _context: ActionContext) -> PreparedAction:
        seen.append(call.has_params)
        if call.has_params:
            assert call.params is None
        return PreparedAction(lambda: ActionResult(call.call_id, True))

    provider.prepare = prepare
    composer = ProviderComposer([provider])
    try:
        request = ActionRequest('reset', None) if supplied else ActionRequest('reset')
        result = await composer.execute(request)
        assert result.ok, result.error
        assert seen == [supplied]
    finally:
        composer.dispose()
