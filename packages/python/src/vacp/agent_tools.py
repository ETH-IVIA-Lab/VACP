"""
The tools a model uses to reach a page through its bridge.

`packages/protocol/test/fixtures/agent-tools.json` and `tool-read.json` hold the same names, input
fields, descriptions, guidance, requests, and reads for TypeScript, so an MCP client gets the tools
`@vacp/agent-ai-sdk` gives an in-page agent.
"""

from __future__ import annotations

from typing import Literal, TypedDict

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
            'Read state keyed by stable refs. Without input it returns the full snapshot. With mode "delta" and '
            'the token of an earlier read it returns only what changed, and refs limits the read.'
        ),
        'input': ['mode', 'since', 'refs', 'includeSummary'],
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
        'Read what an action changed from its result and vacp_state. After actions, prefer vacp_state with mode '
        '"delta" and the token of the previous read, and read once with mode "full" when the lineage is unclear.',
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


class StateRequest(TypedDict, total=False):
    mode: Literal['auto', 'full', 'delta']
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
    mode: Literal['auto', 'full', 'delta'] | None = None,
    since: str | None = None,
    refs: list[str] | None = None,
    includeSummary: bool | None = None,
) -> StateRequest | None:
    """The state request a tool input asks for, or none for the full snapshot."""
    request: StateRequest = {}
    scoped_refs = _scope(refs)
    if mode is not None:
        request['mode'] = mode
    if since is not None:
        request['since'] = since
    if scoped_refs is not None:
        request['refs'] = scoped_refs
    if includeSummary is not None:
        request['includeSummary'] = includeSummary
    return request or None


def tool_read(read: dict[str, object]) -> dict[str, object]:
    """A graph read as an agent tool returns it to a model, without source ownership."""
    graph = read['graph']
    if not isinstance(graph, dict):
        raise TypeError('A graph read must carry a graph object')
    return {**read, 'graph': {key: value for key, value in graph.items() if key != 'ownership'}}
