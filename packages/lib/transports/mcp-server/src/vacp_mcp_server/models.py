from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, StringConstraints, TypeAdapter, with_config
from typing_extensions import TypedDict

NonBlankString = Annotated[str, StringConstraints(min_length=1, pattern=r'.*\S.*')]

VacpNodeKind = Literal[
    'App',
    'View',
    'Visualization',
    'Mark',
    'EncodingChannel',
    'EncodedField',
    'Legend',
    'Axis',
    'Selection',
    'Param',
    'Widget',
    'DataHandle',
    'InteractionTarget',
]

VacpLayer = Literal['ConfigLayer', 'ViewLayer', 'VisualizationLayer', 'DataLayer', 'InteractionFeedbackLayer']


@with_config(ConfigDict(extra='forbid'))
class VacpCapabilitiesRequestOptions(TypedDict, total=False):
    refs: list[NonBlankString]
    prefixes: list[NonBlankString]
    kinds: list[VacpNodeKind]
    layers: list[VacpLayer]
    includeActions: bool
    includeEdges: bool
    includeNodeData: bool


VacpCapabilitiesRequestOptionsAdapter = TypeAdapter(VacpCapabilitiesRequestOptions)


@with_config(ConfigDict(extra='forbid'))
class VacpStateRequestOptions(TypedDict, total=False):
    mode: Literal['auto', 'full', 'delta']
    since: NonBlankString
    refs: list[NonBlankString]
    includeSummary: bool


VacpStateRequestOptionsAdapter = TypeAdapter(VacpStateRequestOptions)


def normalize_state_request_options(options: object | None) -> VacpStateRequestOptions | None:
    if options is None:
        return None
    return VacpStateRequestOptionsAdapter.validate_python(options, strict=True)


def normalize_capabilities_request_options(options: object | None) -> VacpCapabilitiesRequestOptions | None:
    if options is None:
        return None
    return VacpCapabilitiesRequestOptionsAdapter.validate_python(options, strict=True)
