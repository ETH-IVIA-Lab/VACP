"""State-dependent discovery shared by composition and execution."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from vacp.provider import GraphFragment, Invocation, Observation


@dataclass(frozen=True)
class Availability:
    requires: tuple[str, ...] = ()
    unavailable: str | None = None


@dataclass(frozen=True)
class AvailabilityStatus:
    available: bool
    blocked_by: tuple[str, ...] = ()
    reason: str | None = None


class AvailabilityError(ValueError):
    """An invocation rejected by the shared eligibility contract."""

    def __init__(self, message: str, details: Mapping[str, object]) -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class ResolvedObservation:
    inspection: Observation
    observation: Observation
    nodes: Mapping[str, AvailabilityStatus]
    actions: Mapping[str, AvailabilityStatus]


def resolve_availability(graph: GraphFragment) -> tuple[dict[str, AvailabilityStatus], dict[str, AvailabilityStatus]]:
    nodes: dict[str, AvailabilityStatus] = {}
    definitions = {}
    for node in graph.nodes:
        if node.ref in definitions:
            raise ValueError(f'Duplicate availability node {node.ref}')
        definitions[node.ref] = node
    dependents: dict[str, list[str]] = {}
    remaining: dict[str, int] = {}
    ready: list[str] = []
    for node in graph.nodes:
        requirements = dict.fromkeys(node.availability.requires if node.availability else ())
        remaining[node.ref] = len(requirements)
        if not requirements:
            ready.append(node.ref)
        for ref in requirements:
            if ref not in definitions:
                raise ValueError(f'Missing prerequisite {ref} for {node.ref}')
            dependents.setdefault(ref, []).append(node.ref)

    def status(subject: str, availability: Availability | None) -> AvailabilityStatus:
        reason = availability.unavailable if availability else None
        if reason is not None and not reason.strip():
            raise ValueError(f'Availability for {subject} requires a nonempty reason')
        requirements = tuple(dict.fromkeys(availability.requires)) if availability else ()
        for ref in requirements:
            if ref not in nodes:
                raise ValueError(f'Missing prerequisite {ref} for {subject}')
        blocked = tuple(ref for ref in requirements if not nodes[ref].available)
        return AvailabilityStatus(reason is None and not blocked, blocked, reason)

    for ref in ready:
        nodes[ref] = status(ref, definitions[ref].availability)
        for child in dependents.get(ref, ()):
            remaining[child] -= 1
            if remaining[child] == 0:
                ready.append(child)
    if len(nodes) != len(definitions):
        unresolved = ', '.join(ref for ref in definitions if ref not in nodes)
        raise ValueError(f'Cyclic availability prerequisites; unresolved nodes: {unresolved}')
    actions: dict[str, AvailabilityStatus] = {}
    for action in graph.actions:
        if action.name in actions:
            raise ValueError(f'Duplicate availability action {action.name}')
        actions[action.name] = status(action.name, action.availability)
    return nodes, actions


def resolve_observation(inspection: Observation) -> ResolvedObservation:
    nodes, actions = resolve_availability(inspection.graph)
    return ResolvedObservation(inspection, _disclose(inspection, nodes, actions), nodes, actions)


def _disclose(
    observation: Observation,
    nodes: Mapping[str, AvailabilityStatus],
    actions: Mapping[str, AvailabilityStatus],
) -> Observation:
    refs = {ref for ref, status in nodes.items() if status.available}
    names = {name for name, status in actions.items() if status.available}
    return replace(
        observation,
        graph=replace(
            observation.graph,
            nodes=tuple(node for node in observation.graph.nodes if node.ref in refs),
            actions=tuple(action for action in observation.graph.actions if action.name in names),
            edges=tuple(edge for edge in observation.graph.edges if edge.from_ref in refs and edge.to_ref in refs),
        ),
        node_owners={ref: owner for ref, owner in observation.node_owners.items() if ref in refs},
        action_owners={name: owner for name, owner in observation.action_owners.items() if name in names},
        state={ref: value for ref, value in observation.state.items() if ref in refs},
        summary={ref: value for ref, value in observation.summary.items() if ref in refs}
        if observation.summary is not None
        else None,
        freshness={ref: value for ref, value in observation.freshness.items() if ref in refs}
        if observation.freshness is not None
        else None,
    )


def _status_details(status: AvailabilityStatus) -> dict[str, object]:
    result: dict[str, object] = {'available': status.available, 'blockedBy': list(status.blocked_by)}
    if status.reason is not None:
        result['reason'] = status.reason
    return result


def require_action(resolved: ResolvedObservation, call: Invocation) -> None:
    status = resolved.actions.get(call.name)
    if status is None:
        raise AvailabilityError(f'Unknown action: {call.name}', {'code': 'unknown-action', 'action': call.name})
    if not status.available:
        raise AvailabilityError(
            f'Action unavailable: {call.name} ({status.reason or ", ".join(status.blocked_by)})',
            {'code': 'action-unavailable', 'action': call.name, 'status': _status_details(status)},
        )
    action = next(action for action in resolved.inspection.graph.actions if action.name == call.name)
    if not isinstance(call.params, dict):
        return
    for parameter in action.operation.ref_parameters:
        if parameter.role != 'input':
            continue
        ref = call.params.get(parameter.parameter)
        if not isinstance(ref, str):
            continue
        current = resolved.nodes.get(ref)
        if current is None or not current.available:
            details: dict[str, object] = {'code': 'input-unavailable', 'action': call.name, 'ref': ref}
            if current is not None:
                details['status'] = _status_details(current)
            raise AvailabilityError(f'Input unavailable: {ref}', details)
