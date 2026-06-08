from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, get_args

if TYPE_CHECKING:
    from plain_mcp.runtime import PlainMcpRuntime

UseCaseId = Literal['UC1', 'UC2', 'UC3', 'UC4', 'UC5']
USE_CASE_IDS: tuple[UseCaseId, ...] = get_args(UseCaseId)

type ToolCallable = Callable[..., Awaitable[dict[str, object]]]
type ToolFactory = Callable[['PlainMcpRuntime'], ToolCallable]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    title: str
    description: str
    factory: ToolFactory
    read_only: bool = False


@dataclass(frozen=True)
class UseCaseSpec:
    id: UseCaseId
    route: str
    title: str
    tools: tuple[ToolSpec, ...]
