from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from typing import Literal, Protocol, cast
from uuid import uuid4

VACP_SCHEMA_VERSION = '0.1.0'
MAX_COHERENCE_RETRIES = 8
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SourceDescription:
    id: str
    type: str
    title: str
    description: str | None = None
    data: Mapping[str, object] | None = None


@dataclass(frozen=True)
class Node:
    ref: str
    kind: str
    layer: str
    title: str | None = None
    description: str | None = None
    data: Mapping[str, object] | None = None


@dataclass(frozen=True)
class Edge:
    from_ref: str
    to_ref: str
    kind: str


@dataclass(frozen=True)
class OperationResultDescriptor:
    role: Literal['state', 'entity', 'data', 'visualization', 'artifact']
    ref: str | None = None
    kind: str | None = None
    media_type: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class RefParameter:
    parameter: str
    role: Literal['input', 'affects']


@dataclass(frozen=True)
class OperationSemantics:
    kind: Literal['mutation', 'creation', 'evaluation', 'query']
    contract: str | None = None
    input_refs: tuple[str, ...] = ()
    affects: tuple[str, ...] = ()
    ref_parameters: tuple[RefParameter, ...] = ()
    results: tuple[OperationResultDescriptor, ...] = ()


@dataclass(frozen=True)
class OperationDescriptor:
    name: str
    description: str
    operation: OperationSemantics
    title: str | None = None
    parameters: Mapping[str, object] | None = None


@dataclass(frozen=True)
class GraphFragment:
    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]
    actions: tuple[OperationDescriptor, ...]
    version: str = VACP_SCHEMA_VERSION


@dataclass(frozen=True)
class Freshness:
    status: Literal['current', 'stale', 'running', 'error']
    input_revision: str | None = None
    output_revision: str | None = None
    message: str | None = None


@dataclass(frozen=True)
class ProviderObservation:
    revision: str
    observed_at: str
    graph: GraphFragment
    state: Mapping[str, object]
    summary: Mapping[str, object] | None = None
    freshness: Mapping[str, Freshness] | None = None


@dataclass(frozen=True)
class Observation:
    revision: str
    observed_at: str
    sources: tuple[SourceDescription, ...]
    graph: GraphFragment
    node_owners: Mapping[str, str]
    action_owners: Mapping[str, str]
    state: Mapping[str, object]
    summary: Mapping[str, object] | None = None
    freshness: Mapping[str, Freshness] | None = None
    version: str = VACP_SCHEMA_VERSION


@dataclass(frozen=True)
class Invocation:
    call_id: str
    name: str
    params: object | None = None


@dataclass(frozen=True)
class InvocationResult:
    call_id: str
    ok: bool
    result: object | None = None
    error: Mapping[str, object] | None = None


class Provider(Protocol):
    source: SourceDescription

    def observe(self) -> ProviderObservation | Awaitable[ProviderObservation]: ...

    def invoke(self, call: Invocation) -> InvocationResult | Awaitable[InvocationResult]: ...

    def subscribe(self, invalidate: Callable[[], None]) -> Callable[[], None]: ...

    def dispose(self) -> None: ...


def _stable_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def _revision(parts: object) -> str:
    return f'obs_{hashlib.sha256(_stable_json(parts).encode()).hexdigest()[:16]}'


async def _resolve[Value](value: Value | Awaitable[Value]) -> Value:
    if inspect.isawaitable(value):
        return cast(Value, await value)
    return value


@dataclass
class SimpleProvider:
    source: SourceDescription
    project: Callable[[], ProviderObservation | Awaitable[ProviderObservation]]
    invoke_operation: Callable[[Invocation], InvocationResult | Awaitable[InvocationResult]]
    subscribe_changes: Callable[[Callable[[], None]], Callable[[], None]] | None = None
    close: Callable[[], None] | None = None

    def observe(self) -> ProviderObservation | Awaitable[ProviderObservation]:
        return self.project()

    def invoke(self, call: Invocation) -> InvocationResult | Awaitable[InvocationResult]:
        return self.invoke_operation(call)

    def subscribe(self, invalidate: Callable[[], None]) -> Callable[[], None]:
        return self.subscribe_changes(invalidate) if self.subscribe_changes else lambda: None

    def dispose(self) -> None:
        if self.close:
            self.close()


class ProviderComposer:
    def __init__(self, providers: Sequence[Provider]) -> None:
        self.session_id = uuid4().hex
        self._providers = tuple(providers)
        self._by_source: dict[str, Provider] = {}
        self._epoch = 0
        self._disposed = False
        self._listeners: set[Callable[[], None]] = set()
        for provider in self._providers:
            if provider.source.id in self._by_source:
                raise ValueError(f'Duplicate VACP source: {provider.source.id}')
            self._by_source[provider.source.id] = provider
        with ExitStack() as subscriptions:
            for provider in self._providers:
                subscriptions.callback(provider.subscribe(self._invalidate))
            self._subscriptions = subscriptions.pop_all()

    def subscribe(self, invalidate: Callable[[], None]) -> Callable[[], None]:
        self._ensure_active()
        self._listeners.add(invalidate)
        return lambda: self._listeners.discard(invalidate)

    def _invalidate(self) -> None:
        if self._disposed:
            return
        self._epoch += 1
        for listener in tuple(self._listeners):
            try:
                listener()
            except Exception:
                logger.exception('VACP observation subscriber failed')

    def _ensure_active(self) -> None:
        if self._disposed:
            raise RuntimeError('VACP composer is disposed')

    async def observe(self) -> Observation:
        self._ensure_active()
        for _ in range(MAX_COHERENCE_RETRIES):
            before = self._epoch
            observations = await asyncio.gather(*(_resolve(provider.observe()) for provider in self._providers))
            self._ensure_active()
            if before != self._epoch:
                continue
            return _compose(self._providers, observations)
        raise RuntimeError('VACP sources did not settle into one coherent observation')

    async def invoke(self, call: Invocation) -> InvocationResult:
        observation = await self.observe()
        source_id = observation.action_owners.get(call.name)
        if source_id is None:
            return InvocationResult(call.call_id, False, error={'message': f'Unknown operation: {call.name}'})
        result = await _resolve(self._by_source[source_id].invoke(call))
        self._ensure_active()
        return result

    def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        self._listeners.clear()
        with ExitStack() as cleanup:
            for provider in reversed(self._providers):
                cleanup.callback(provider.dispose)
            cleanup.callback(self._subscriptions.close)


def _compose(providers: Sequence[Provider], observations: Sequence[ProviderObservation]) -> Observation:
    nodes: list[Node] = []
    edges: list[Edge] = []
    operations: list[OperationDescriptor] = []
    node_owners: dict[str, str] = {}
    action_owners: dict[str, str] = {}
    state: dict[str, object] = {}
    summary: dict[str, object] = {}
    freshness: dict[str, Freshness] = {}
    edge_keys: set[tuple[str, str, str]] = set()

    for provider, observation in zip(providers, observations, strict=True):
        source_id = provider.source.id
        if observation.graph.version != VACP_SCHEMA_VERSION:
            raise ValueError(f'Source {source_id} published unsupported graph version {observation.graph.version}')
        for node in observation.graph.nodes:
            owner = node_owners.get(node.ref)
            if owner:
                raise ValueError(f'Node {node.ref} is owned by both {owner} and {source_id}')
            node_owners[node.ref] = source_id
            nodes.append(node)
        for operation in observation.graph.actions:
            owner = action_owners.get(operation.name)
            if owner:
                raise ValueError(f'Operation {operation.name} is owned by both {owner} and {source_id}')
            action_owners[operation.name] = source_id
            operations.append(operation)
        for edge in observation.graph.edges:
            key = (edge.from_ref, edge.to_ref, edge.kind)
            if key not in edge_keys:
                edge_keys.add(key)
                edges.append(edge)

    known_refs = set(node_owners)
    for edge in edges:
        if edge.from_ref not in known_refs or edge.to_ref not in known_refs:
            raise ValueError(f'Edge {edge.from_ref} -> {edge.to_ref} references a missing node')

    for operation in operations:
        for ref in (*operation.operation.input_refs, *operation.operation.affects):
            if ref not in known_refs:
                raise ValueError(f'Operation {operation.name} references missing entity {ref}')

    for provider, observation in zip(providers, observations, strict=True):
        for label, values in (
            ('State', observation.state),
            ('Summary', observation.summary),
            ('Freshness', observation.freshness),
        ):
            for ref in values or {}:
                owner = node_owners.get(ref)
                if owner is None:
                    raise ValueError(f'{label} {ref} from {provider.source.id} has no node in the composed graph')
                if owner != provider.source.id:
                    raise ValueError(f'{label} {ref} is owned by both {owner} and {provider.source.id}')
        state.update(observation.state)
        summary.update(observation.summary or {})
        freshness.update(observation.freshness or {})

    revision_parts = [
        (provider.source.id, observation.revision)
        for provider, observation in zip(providers, observations, strict=True)
    ]
    observed_at = max((observation.observed_at for observation in observations), default='')
    return Observation(
        revision=_revision(revision_parts),
        observed_at=observed_at,
        sources=tuple(provider.source for provider in providers),
        graph=GraphFragment(tuple(nodes), tuple(edges), tuple(operations)),
        node_owners=node_owners,
        action_owners=action_owners,
        state=state,
        summary=summary or None,
        freshness=freshness or None,
    )


def as_dict(value: Observation) -> dict[str, object]:
    """Serialize a composed observation using the VACP wire names."""
    graph = {
        'version': value.graph.version,
        'sources': [_compact(asdict(source)) for source in value.sources],
        'ownership': {
            'nodes': dict(value.node_owners),
            'actions': dict(value.action_owners),
        },
        'nodes': [_compact(asdict(node)) for node in value.graph.nodes],
        'edges': [{'from': edge.from_ref, 'to': edge.to_ref, 'kind': edge.kind} for edge in value.graph.edges],
        'actions': [_operation_dict(action) for action in value.graph.actions],
    }
    return _compact(
        {
            'version': value.version,
            'revision': value.revision,
            'observedAt': value.observed_at,
            'graph': graph,
            'state': dict(value.state),
            'summary': dict(value.summary) if value.summary else None,
            'freshness': {ref: _freshness_dict(item) for ref, item in (value.freshness or {}).items()} or None,
        }
    )


def _operation_dict(action: OperationDescriptor) -> dict[str, object]:
    semantics = action.operation
    return _compact(
        {
            'name': action.name,
            'title': action.title,
            'description': action.description,
            'parameters': dict(action.parameters) if action.parameters else None,
            'operation': _compact(
                {
                    'kind': semantics.kind,
                    'contract': semantics.contract,
                    'inputRefs': list(semantics.input_refs) or None,
                    'affects': list(semantics.affects) or None,
                    'refParameters': [
                        {'parameter': item.parameter, 'role': item.role} for item in semantics.ref_parameters
                    ]
                    or None,
                    'results': [
                        _compact(
                            {
                                'role': item.role,
                                'ref': item.ref,
                                'kind': item.kind,
                                'mediaType': item.media_type,
                                'description': item.description,
                            }
                        )
                        for item in semantics.results
                    ]
                    or None,
                }
            ),
        }
    )


def _freshness_dict(value: Freshness) -> dict[str, object]:
    return _compact(
        {
            'status': value.status,
            'inputRevision': value.input_revision,
            'outputRevision': value.output_revision,
            'message': value.message,
        }
    )


def _compact(value: Mapping[str, object]) -> dict[str, object]:
    return {key: item for key, item in value.items() if item is not None}
