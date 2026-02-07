from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, StringConstraints, TypeAdapter, ValidationError
from typing_extensions import TypedDict

NonBlankString = Annotated[str, StringConstraints(min_length=1, pattern=r'.*\S.*')]


class VacpStateRequestOptions(TypedDict, total=False):
    __pydantic_config__ = ConfigDict(extra='forbid')

    mode: Literal['auto', 'full', 'delta']
    since: NonBlankString
    refs: list[NonBlankString]
    includeSummary: bool


VacpStateRequestOptionsAdapter = TypeAdapter(VacpStateRequestOptions)

StateRequestFieldMessages: dict[str, str] = {
    'mode': 'Expected options.mode to be one of: auto, full, delta',
    'since': 'Expected options.since to be a non-empty string',
    'refs': 'Expected options.refs to be an array of strings',
    'includeSummary': 'Expected options.includeSummary to be a boolean',
}


def normalize_state_request_options(options: object | None) -> VacpStateRequestOptions | None:
    if options is None:
        return None
    try:
        return VacpStateRequestOptionsAdapter.validate_python(options, strict=True)
    except ValidationError as exc:
        raise ValueError(state_request_validation_message(exc)) from exc


def state_request_validation_message(exc: ValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return 'Invalid options'

    unknown_keys = sorted(
        {
            str(loc[0])
            for err in errors
            if err.get('type') == 'extra_forbidden'
            for loc in [err.get('loc')]
            if isinstance(loc, tuple) and loc and isinstance(loc[0], str)
        }
    )
    if unknown_keys:
        return f'Unknown options key(s): {", ".join(unknown_keys)}'

    first = errors[0]
    err_type = str(first.get('type', ''))
    loc = first.get('loc')
    path = loc if isinstance(loc, tuple) else ()
    if err_type == 'dict_type' and not path:
        return 'Expected options to be a JSON object'

    if len(path) > 1 and path[0] == 'refs':
        return 'Expected every options.refs item to be a non-empty string'

    field = path[0] if path and isinstance(path[0], str) else None
    if field is None:
        return 'Invalid options'
    return StateRequestFieldMessages.get(field, 'Invalid options')
