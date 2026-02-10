from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, StringConstraints, TypeAdapter, with_config
from typing_extensions import TypedDict

NonBlankString = Annotated[str, StringConstraints(min_length=1, pattern=r'.*\S.*')]


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
