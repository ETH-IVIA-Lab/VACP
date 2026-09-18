from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import cast

import pytest
from vacp import (
    Edge,
    Freshness,
    GraphFragment,
    Invocation,
    InvocationResult,
    Node,
    OperationDescriptor,
    OperationResultDescriptor,
    OperationSemantics,
    ProviderComposer,
    ProviderObservation,
    SimpleProvider,
    SourceDescription,
    as_dict,
)


def record(value: object) -> Mapping[str, object]:
    assert isinstance(value, Mapping)
    return cast(Mapping[str, object], value)


def source(source_id: str, ref: str, operation: str, *, edge: Edge | None = None) -> SimpleProvider:
    description = SourceDescription(source_id, 'test', source_id)

    def project() -> ProviderObservation:
        return ProviderObservation(
            revision='1',
            observed_at=datetime.now(UTC).isoformat(),
            graph=GraphFragment(
                nodes=(Node(ref, 'TestOutput', 'AnalysisLayer'),),
                edges=(edge,) if edge else (),
                actions=(
                    OperationDescriptor(
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
        description,
        project,
        lambda call: InvocationResult(call.call_id, True, result=source_id),
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
        assert await composer.invoke(Invocation('run', 'notebook.evaluate')) == InvocationResult(
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

    current.close = close
    composer = ProviderComposer([current])
    await composer.observe()
    current.project = source('vacp-source://dynamic', 'vacp://dynamic', 'second').project
    result = await composer.invoke(Invocation('new', 'second'))
    assert result.ok
    assert not (await composer.invoke(Invocation('old', 'first'))).ok
    composer.dispose()
    composer.dispose()
    assert close_count == 1
    with pytest.raises(RuntimeError, match='disposed'):
        await composer.observe()


@pytest.mark.asyncio
async def test_disposal_rejects_pending_observations_before_operation_dispatch() -> None:
    current = source('source', 'node', 'run')
    project = current.project
    entered, release = asyncio.Event(), asyncio.Event()
    invoked = False

    async def observe() -> ProviderObservation:
        entered.set()
        await release.wait()
        result = project()
        assert isinstance(result, ProviderObservation)
        return result

    def invoke(call: Invocation) -> InvocationResult:
        nonlocal invoked
        invoked = True
        return InvocationResult(call.call_id, True)

    current.project, current.invoke_operation = observe, invoke
    composer = ProviderComposer([current])
    pending = asyncio.create_task(composer.invoke(Invocation('call', 'run')))
    await entered.wait()
    composer.dispose()
    release.set()
    with pytest.raises(RuntimeError, match='disposed'):
        await pending
    assert not invoked


@pytest.mark.asyncio
async def test_disposal_rejects_late_operation_results() -> None:
    current = source('source', 'node', 'run')
    entered, release = asyncio.Event(), asyncio.Event()

    async def invoke(call: Invocation) -> InvocationResult:
        entered.set()
        await release.wait()
        return InvocationResult(call.call_id, True)

    current.invoke_operation = invoke
    composer = ProviderComposer([current])
    pending = asyncio.create_task(composer.invoke(Invocation('call', 'run')))
    await entered.wait()
    composer.dispose()
    release.set()
    with pytest.raises(RuntimeError, match='disposed'):
        await pending


def test_failed_construction_releases_acquired_subscriptions() -> None:
    attached: list[Callable[[], None]] = []

    def subscribe(callback: Callable[[], None]) -> Callable[[], None]:
        attached.append(callback)
        return lambda: attached.remove(callback)

    def fail(_callback: Callable[[], None]) -> Callable[[], None]:
        raise RuntimeError('Cannot subscribe')

    first, second = source('first', 'a', 'a'), source('second', 'b', 'b')
    first.subscribe_changes, second.subscribe_changes = subscribe, fail
    with pytest.raises(RuntimeError, match='Cannot subscribe'):
        ProviderComposer([first, second])
    assert not attached


def test_disposal_releases_every_source_even_when_cleanup_fails() -> None:
    released: list[str] = []

    def failing_cleanup() -> None:
        released.append('failed cleanup')
        raise RuntimeError('Cleanup failed')

    first, second = source('first', 'a', 'a'), source('second', 'b', 'b')
    first.subscribe_changes = lambda _callback: failing_cleanup
    first.close = failing_cleanup
    second.subscribe_changes = lambda _callback: lambda: released.append('second subscription')
    second.close = lambda: released.append('second provider')
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

    def invoke(call: Invocation) -> InvocationResult:
        for callback in callbacks:
            callback()
        return InvocationResult(call.call_id, True)

    def fail() -> None:
        raise RuntimeError('Broken viewer')

    current.subscribe_changes, current.invoke_operation = subscribe, invoke
    composer = ProviderComposer([current])
    composer.subscribe(fail)
    composer.subscribe(lambda: notified.append('changed'))
    try:
        assert (await composer.invoke(Invocation('call', 'run'))).ok
        assert notified == ['changed']
        assert 'Broken viewer' in caplog.text
    finally:
        composer.dispose()
