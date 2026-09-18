from __future__ import annotations

from typing import Annotated, Literal, cast

from pydantic import ConfigDict, StringConstraints, TypeAdapter, with_config
from typing_extensions import TypedDict

NonBlankString = Annotated[str, StringConstraints(min_length=1, pattern=r'.*\S.*')]


@with_config(ConfigDict(extra='forbid'))
class VacpCapabilitiesRequestOptions(TypedDict, total=False):
    refs: list[NonBlankString]
    prefixes: list[NonBlankString]
    kinds: list[NonBlankString]
    layers: list[NonBlankString]
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


def _normalize_ref_scope(values: list[str] | None) -> list[str] | None:
    if not values:
        return None
    filtered = [value for value in values if value != 'vacp://']
    return filtered or None


def normalize_state_request_options(options: object | None) -> VacpStateRequestOptions | None:
    if options is None:
        return None
    normalized = dict(VacpStateRequestOptionsAdapter.validate_python(options, strict=True))
    refs = _normalize_ref_scope(cast(list[str] | None, normalized.get('refs')))
    if refs is None:
        normalized.pop('refs', None)
    else:
        normalized['refs'] = refs
    return cast(VacpStateRequestOptions, normalized or None)


def normalize_capabilities_request_options(options: object | None) -> VacpCapabilitiesRequestOptions | None:
    if options is None:
        return None
    normalized = dict(VacpCapabilitiesRequestOptionsAdapter.validate_python(options, strict=True))
    refs = _normalize_ref_scope(cast(list[str] | None, normalized.get('refs')))
    prefixes = _normalize_ref_scope(cast(list[str] | None, normalized.get('prefixes')))
    if refs is None:
        normalized.pop('refs', None)
    else:
        normalized['refs'] = refs
    if prefixes is None:
        normalized.pop('prefixes', None)
    else:
        normalized['prefixes'] = prefixes
    return cast(VacpCapabilitiesRequestOptions, normalized or None)
