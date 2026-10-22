from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import ExitStack
from copy import deepcopy
from dataclasses import asdict, dataclass, field, replace
from typing import Literal, Protocol, TypeVar, cast
from uuid import uuid4

from vacp.availability import Availability, AvailabilityError, ResolvedObservation, require_action, resolve_observation
from vacp.narration import WHITESPACE

VACP_SCHEMA_VERSION = '0.1.0'
MAX_COHERENCE_RETRIES = 8
logger = logging.getLogger(__name__)
_OMITTED = object()
Value = TypeVar('Value')


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
    availability: Availability | None = None


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
class ActionDescriptor:
    name: str
    description: str
    operation: OperationSemantics
    title: str | None = None
    parameters: Mapping[str, object] | None = None
    availability: Availability | None = None


@dataclass(frozen=True)
class GraphFragment:
    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]
    actions: tuple[ActionDescriptor, ...]


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
class ActionRequest:
    """An action a caller asks to run. The composer, or the page's runtime, assigns `call_id` when None or blank."""

    name: str
    params: object = _OMITTED
    call_id: str | None = field(default=None, kw_only=True)

    @property
    def has_params(self) -> bool:
        """Whether the caller supplied parameters, including an explicit None."""
        return self.params is not _OMITTED


@dataclass(frozen=True)
class ActionCall:
    """A request as the composer runs it, with the caller's `call_id` or the one it assigned."""

    call_id: str
    name: str
    params: object = _OMITTED

    @property
    def has_params(self) -> bool:
        """Whether the caller supplied parameters, including an explicit None."""
        return self.params is not _OMITTED


@dataclass(frozen=True)
class ActionResult:
    call_id: str
    ok: bool
    result: object | None = None
    error: Mapping[str, object] | None = None


@dataclass(frozen=True)
class ActionContext:
    """The source lifetime a provider checks before it mutates its source."""

    closed: Callable[[], bool]

    def ensure_open(self) -> None:
        if self.closed():
            raise RuntimeError('VACP composer is disposed')


class PreparedAction:
    """A validated, single-use operation. Preparation must not mutate the analytical source."""

    def __init__(
        self, run: Callable[[], ActionResult | Awaitable[ActionResult]], *, affects: Sequence[str] = ()
    ) -> None:
        self.affects = tuple(affects)
        self._run: Callable[[], ActionResult | Awaitable[ActionResult]] | None = run

    async def execute(self) -> ActionResult:
        run, self._run = self._run, None
        if run is None:
            raise RuntimeError('Prepared action has already been executed')
        return await _resolve(run())


class Provider(Protocol):
    @property
    def source(self) -> SourceDescription: ...

    def observe(self) -> ProviderObservation | Awaitable[ProviderObservation]: ...

    def prepare(self, call: ActionCall, context: ActionContext, /) -> PreparedAction | Awaitable[PreparedAction]:
        """Validate `call` and resolve its target without mutating the source."""
        ...

    def subscribe(self, invalidate: Callable[[], None], /) -> Callable[[], None]: ...

    def dispose(self) -> None: ...


def _stable_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def _revision(parts: object) -> str:
    return f'obs_{hashlib.sha256(_stable_json(parts).encode()).hexdigest()[:16]}'


async def _resolve(value: Value | Awaitable[Value]) -> Value:
    if inspect.isawaitable(value):
        return cast(Value, await value)
    return value


def _unchanging(_invalidate: Callable[[], None]) -> Callable[[], None]:
    return lambda: None


def _nothing() -> None:
    return None


@dataclass
class SimpleProvider:
    """A provider assembled from its members, for sources without a class of their own."""

    source: SourceDescription
    observe: Callable[[], ProviderObservation | Awaitable[ProviderObservation]]
    prepare: Callable[[ActionCall, ActionContext], PreparedAction | Awaitable[PreparedAction]]
    subscribe: Callable[[Callable[[], None]], Callable[[], None]] = _unchanging
    dispose: Callable[[], None] = _nothing


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
        return (await self._read()).observation

    async def inspect(self) -> Observation:
        return (await self._read()).inspection

    async def _read(self) -> ResolvedObservation:
        self._ensure_active()
        for _ in range(MAX_COHERENCE_RETRIES):
            before = self._epoch
            observations = await asyncio.gather(*(_resolve(provider.observe()) for provider in self._providers))
            self._ensure_active()
            if before != self._epoch:
                continue
            # Capture once: later changes to provider data cannot reach this observation, and its
            # consumers cannot reach the provider.
            return resolve_observation(_compose(self._providers, deepcopy(observations)))
        raise RuntimeError('VACP sources did not settle into one coherent observation')

    async def execute(self, request: ActionRequest) -> ActionResult:
        """Prepare the call with its owner, recheck lifetime and eligibility, then run it once."""
        if request.call_id is not None and not isinstance(request.call_id, str):
            raise TypeError('call_id must be a string')
        call_id = request.call_id if request.call_id and request.call_id.strip(WHITESPACE) else str(uuid4())
        call = (
            ActionCall(call_id, request.name, deepcopy(request.params))
            if request.has_params
            else ActionCall(call_id, request.name)
        )
        resolved = await self._read()
        try:
            require_action(resolved, call)
        except AvailabilityError as error:
            return ActionResult(call.call_id, False, error={'message': str(error), 'details': error.details})
        provider = self._by_source[resolved.inspection.action_owners[call.name]]
        try:
            prepared = await _resolve(provider.prepare(call, ActionContext(lambda: self._disposed)))
        except Exception as error:  # noqa: BLE001
            return ActionResult(call.call_id, False, error={'message': str(error)})
        current = await self._read()
        try:
            require_action(current, call)
        except AvailabilityError as error:
            return ActionResult(call.call_id, False, error={'message': str(error), 'details': error.details})
        # The composer owns the call ID, so a provider cannot answer under another one.
        return replace(await prepared.execute(), call_id=call.call_id)

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
    operations: list[ActionDescriptor] = []
    node_owners: dict[str, str] = {}
    action_owners: dict[str, str] = {}
    state: dict[str, object] = {}
    summary: dict[str, object] = {}
    freshness: dict[str, Freshness] = {}
    edge_keys: set[tuple[str, str, str]] = set()

    for provider, observation in zip(providers, observations, strict=True):
        source_id = provider.source.id
        for node in observation.graph.nodes:
            owner = node_owners.get(node.ref)
            if owner:
                raise ValueError(f'Node {node.ref} is owned by both {owner} and {source_id}')
            node_owners[node.ref] = source_id
            nodes.append(node)
        for operation in observation.graph.actions:
            owner = action_owners.get(operation.name)
            if owner:
                raise ValueError(f'Action {operation.name} is owned by both {owner} and {source_id}')
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
                raise ValueError(f'Action {operation.name} references missing entity {ref}')

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
        sources=tuple(deepcopy(provider.source) for provider in providers),
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
        'sources': [_compact(asdict(source)) for source in value.sources],
        'ownership': {
            'nodes': dict(value.node_owners),
            'actions': dict(value.action_owners),
        },
        'nodes': [
            _compact({**asdict(node), 'availability': _availability_dict(node.availability)})
            for node in value.graph.nodes
        ],
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


def _availability_dict(value: Availability | None) -> dict[str, object] | None:
    if value is None:
        return None
    return _compact({'requires': list(value.requires) or None, 'unavailable': value.unavailable})


def _operation_dict(action: ActionDescriptor) -> dict[str, object]:
    semantics = action.operation
    return _compact(
        {
            'name': action.name,
            'title': action.title,
            'description': action.description,
            'parameters': dict(action.parameters) if action.parameters else None,
            'availability': _availability_dict(action.availability),
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
