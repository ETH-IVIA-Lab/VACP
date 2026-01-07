"""
Diagram rendering (project concepts).

This module renders VACP graphs into human-friendly diagrams for debugging.

Why diagrams matter:
- Providers generate a semantic graph of nodes/edges and a set of actions.
- Diagrams make it easy to validate structure, identity stability, and action targets.

Mermaid only (for now).

The output is intentionally text-first:
- easy to paste into Markdown Mermaid blocks
- easy to log/inspect over MCP
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class DiagramOptions:
    direction: Literal['LR', 'TB'] = 'LR'
    include_actions: bool = False
    include_state_preview: bool = False
    max_label_length: int = 80


def clamp_label(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max(0, max_len - 1)] + '…'


def short_ref(ref: str) -> str:
    # Prefer a readable suffix for labels.
    ref = ref.split('#', 1)[0]
    parts = [p for p in ref.split('/') if p]
    return '/'.join(parts[-2:])


def _escape_mermaid_label(s: str) -> str:
    # Prevent accidental syntax termination inside ["..."] node labels.
    # Mermaid parsing is sensitive to quotes inside labels; keep this strict.
    return s.replace('\\', '\\\\').replace('\r', '').replace('\n', '\\n').replace('"', "'")


def render_mermaid(*, graph: dict, state: dict | None, options: DiagramOptions) -> str:
    nodes = graph.get('nodes', []) if isinstance(graph, dict) else []
    edges = graph.get('edges', []) if isinstance(graph, dict) else []
    actions = graph.get('actions', []) if isinstance(graph, dict) else []

    ref_to_idx: dict[str, int] = {}
    for i, node in enumerate(nodes):
        ref = node.get('ref') if isinstance(node, dict) else None
        if isinstance(ref, str):
            ref_to_idx[ref] = i

    lines: list[str] = [f'flowchart {options.direction}']

    def node_id(i: int) -> str:
        return f'n{i}'

    def action_id(i: int) -> str:
        return f'a{i}'

    state_map = state.get('state') if isinstance(state, dict) else None

    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        kind = str(node.get('kind', 'Node'))
        title = node.get('title')
        title_s = clamp_label(str(title), options.max_label_length) if title else ''
        ref = node.get('ref')
        ref_s = clamp_label(short_ref(str(ref)), options.max_label_length) if ref else ''
        label_lines = [x for x in [kind, title_s, ref_s] if x]

        if options.include_state_preview and isinstance(state_map, dict) and isinstance(ref, str) and ref in state_map:
            preview = clamp_label(str(state_map[ref]), options.max_label_length)
            label_lines.append(f'state={preview}')

        label = _escape_mermaid_label('\\n'.join(label_lines))
        lines.append(f'{node_id(i)}["{label}"]')

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        frm = edge.get('from')
        to = edge.get('to')
        kind = edge.get('kind', '')
        if not (isinstance(frm, str) and isinstance(to, str)):
            continue
        if frm not in ref_to_idx or to not in ref_to_idx:
            continue
        lines.append(f'{node_id(ref_to_idx[frm])} -->|{kind}| {node_id(ref_to_idx[to])}')

    if options.include_actions:
        for i, action in enumerate(actions):
            if not isinstance(action, dict):
                continue
            name = clamp_label(str(action.get('name', 'action')), options.max_label_length)
            lines.append(f'{action_id(i)}(["action\\n{_escape_mermaid_label(name)}"])')
            target_ref = action.get('targetRef')
            if isinstance(target_ref, str) and target_ref in ref_to_idx:
                lines.append(f'{action_id(i)} -.-> {node_id(ref_to_idx[target_ref])}')

    return '\n'.join(lines)


def render_diagram(
    *,
    graph: dict,
    state: dict | None = None,
    options: DiagramOptions | None = None,
) -> str:
    options = options or DiagramOptions()
    return render_mermaid(graph=graph, state=state, options=options)
