"""
The tools a model uses to reach a page through its bridge.

`packages/protocol/test/fixtures/agent-tools.json`, `tool-read.json`, and `tool-result.json` hold the
same names, input fields, descriptions, guidance, requests, reads, and result bounds for TypeScript,
so an MCP client gets the tools `@ethivia/vacp-ai-sdk` gives an in-page agent.
"""

from __future__ import annotations

import math
from typing import TypedDict, overload

from vacp.narration import PROGRESS_GUIDANCE


class AgentTool(TypedDict):
    description: str
    input: list[str]


AGENT_TOOLS: dict[str, AgentTool] = {
    'vacp_observe': {
        'description': ('Read the graph, available actions, state, revision, and output freshness in one observation.'),
        'input': [],
    },
    'vacp_capabilities': {
        'description': (
            'Read the graph and its available actions. Scope the read by refs, prefixes, kinds, or layers once '
            'targets are known. Name actions in vacp_execute by graph.actions[].name.'
        ),
        'input': ['refs', 'prefixes', 'kinds', 'layers', 'includeActions', 'includeEdges', 'includeNodeData'],
    },
    'vacp_state': {
        'description': (
            'Read state keyed by stable refs. Without since it returns the full state and a token. With since set '
            'to the token of an earlier read it returns only what changed since then. refs limits the read.'
        ),
        'input': ['since', 'refs', 'includeSummary'],
    },
    'vacp_execute': {
        'description': (
            'Run one semantic action by its name from the graph, with params matching its parameters schema and '
            'a narration sentence for this step. Returns { callId, ok, result, error }.'
        ),
        'input': ['name', 'params', 'narration', 'call_id'],
    },
    'vacp_progress': {'description': PROGRESS_GUIDANCE, 'input': ['message', 'done']},
}

TOOL_GUIDANCE = ' '.join(
    [
        'Read vacp_observe once at the start of a request. Only the actions available now are disclosed.',
        'Observe again only when the available actions may have changed, such as after loading a dataset, or '
        'when vacp_execute reports an unknown or unavailable action.',
        'Read what an action changed from its result and vacp_state. After actions, prefer vacp_state with since '
        'set to the token of the previous read, and read once without since when the lineage is unclear.',
        'Scope vacp_capabilities and vacp_state by refs once targets are known. Omit scope fields for an unscoped '
        'read, which leaves out node data unless includeNodeData is true.',
        'Call vacp_progress once before the first action with one plain sentence for the person, give every '
        'vacp_execute its own narration, and close the task with vacp_progress and done set to true.',
    ]
)


class CapabilitiesRequest(TypedDict, total=False):
    refs: list[str]
    prefixes: list[str]
    kinds: list[str]
    layers: list[str]
    includeActions: bool
    includeEdges: bool
    includeNodeData: bool


class Actor(TypedDict):
    id: str
    kind: str


AGENT_ACTOR: Actor = {'id': 'agent', 'kind': 'agent'}
"""The actor steps and narration are attributed to, as every agent transport attributes them."""


class StateRequest(TypedDict, total=False):
    since: str
    refs: list[str]
    includeSummary: bool


def _scope(refs: list[str] | None) -> list[str] | None:
    """A bare `vacp://` scope names everything, which is an unscoped read."""
    scoped = [ref for ref in refs or [] if ref != 'vacp://']
    return scoped or None


def capabilities_request(
    *,
    refs: list[str] | None = None,
    prefixes: list[str] | None = None,
    kinds: list[str] | None = None,
    layers: list[str] | None = None,
    includeActions: bool | None = None,
    includeEdges: bool | None = None,
    includeNodeData: bool | None = None,
) -> CapabilitiesRequest:
    """The capabilities request a tool input asks for. An unscoped read leaves out node data unless asked."""
    request: CapabilitiesRequest = {}
    scoped_refs = _scope(refs)
    scoped_prefixes = _scope(prefixes)
    if scoped_refs is not None:
        request['refs'] = scoped_refs
    if scoped_prefixes is not None:
        request['prefixes'] = scoped_prefixes
    if kinds is not None:
        request['kinds'] = kinds
    if layers is not None:
        request['layers'] = layers
    if includeActions is not None:
        request['includeActions'] = includeActions
    if includeEdges is not None:
        request['includeEdges'] = includeEdges
    if includeNodeData is not None:
        request['includeNodeData'] = includeNodeData
    elif not (scoped_refs or scoped_prefixes or kinds or layers):
        request['includeNodeData'] = False
    return request


def state_request(
    *,
    since: str | None = None,
    refs: list[str] | None = None,
    includeSummary: bool | None = None,
) -> StateRequest:
    """The state request a tool input asks for. Every answer carries a token."""
    request: StateRequest = {}
    scoped_refs = _scope(refs)
    if since is not None:
        request['since'] = since
    if scoped_refs is not None:
        request['refs'] = scoped_refs
    if includeSummary is not None:
        request['includeSummary'] = includeSummary
    return request


def tool_read(read: dict[str, object]) -> dict[str, object]:
    """A graph read as an agent tool returns it to a model, without source ownership."""
    graph = read['graph']
    if not isinstance(graph, dict):
        raise TypeError('A graph read must carry a graph object')
    return {**read, 'graph': {key: value for key, value in graph.items() if key != 'ownership'}}


class ToolResultLimits(TypedDict):
    depth: int
    items: int
    keys: int
    characters: int


TOOL_RESULT_LIMITS: ToolResultLimits = {'depth': 32, 'items': 500, 'keys': 160, 'characters': 12_000}


def _cut_text(count: int) -> str:
    return f'... [{count} more characters]'


def _text(value: str, limit: int) -> str:
    """`value`, or its first code points with a marker counting the rest, within `limit` code points in all."""
    total = len(value)
    if total <= limit:
        return value
    keep = max(0, limit - len(_cut_text(total - limit)))
    while keep > 0 and keep + len(_cut_text(total - keep)) > limit:
        keep -= 1
    return f'{value[:keep]}{_cut_text(total - keep)}'


def _kept(size: int, limit: int) -> int:
    """Items a collection of `size` keeps: all of them, or room for the marker that ends a cut."""
    return max(0, limit - 1) if size > limit else size


def _bound(value: object, depth: int, limits: ToolResultLimits) -> object:
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        return 'NaN' if math.isnan(value) else ('Infinity' if value > 0 else '-Infinity')
    if isinstance(value, str):
        return _text(value, limits['characters'])
    if isinstance(value, (list, tuple)):
        if depth > limits['depth']:
            return f'[Array({len(value)})]'
        keep = _kept(len(value), limits['items'])
        items: list[object] = [_bound(item, depth + 1, limits) for item in value[:keep]]
        if keep < len(value):
            items.append(f'[{len(value) - keep} more items]')
        return items
    if isinstance(value, dict):
        if depth > limits['depth']:
            return '[Object]'
        entries = list(value.items())
        keep = _kept(len(entries), limits['keys'])
        result: dict[str, object] = {str(key): _bound(entry, depth + 1, limits) for key, entry in entries[:keep]}
        if keep < len(entries):
            result['__truncated'] = f'{len(entries) - keep} more keys'
        return result
    return str(value)


@overload
def tool_result(value: dict[str, object], limits: ToolResultLimits = ...) -> dict[str, object]: ...
@overload
def tool_result(value: object, limits: ToolResultLimits = ...) -> object: ...
def tool_result(value: object, limits: ToolResultLimits = TOOL_RESULT_LIMITS) -> object:
    """`value` as JSON a model reads, bounded as every transport bounds its tool results.

    A string keeps `limits['characters']` code points, a list `limits['items']` items, and a dict
    `limits['keys']` keys, each counting the marker that says what was cut. Containers deeper than
    `limits['depth']` read as `[Array(n)]` or `[Object]`. A bounded value passes through unchanged.
    """
    return _bound(value, 0, limits)
