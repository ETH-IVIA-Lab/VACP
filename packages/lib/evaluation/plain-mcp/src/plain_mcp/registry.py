from __future__ import annotations

from typing import cast

from plain_mcp.protocol import USE_CASE_IDS, UseCaseId, UseCaseSpec
from plain_mcp.use_cases import (
    AIRPORTS_SPEC,
    ATHLETES_SPEC,
    CARS_SPEC,
    GLOBAL_DEVELOPMENT_SPEC,
    SEATTLE_WEATHER_SPEC,
)

USE_CASES: dict[UseCaseId, UseCaseSpec] = {
    'UC1': GLOBAL_DEVELOPMENT_SPEC,
    'UC2': SEATTLE_WEATHER_SPEC,
    'UC3': ATHLETES_SPEC,
    'UC4': AIRPORTS_SPEC,
    'UC5': CARS_SPEC,
}


def get_use_case(use_case_id: str) -> UseCaseSpec:
    normalized = use_case_id.upper()
    if normalized not in USE_CASES:
        choices = ', '.join(USE_CASE_IDS)
        raise ValueError(f'Unknown use case {use_case_id!r}. Expected one of: {choices}')
    return USE_CASES[cast(UseCaseId, normalized)]
