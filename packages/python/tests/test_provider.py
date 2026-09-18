from __future__ import annotations

from collections.abc import Mapping
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
