# @vacp/diagrams

Render VACP graphs to Mermaid (for debugging).

This package is intentionally “text-first”: it outputs Mermaid source that you can:

- paste into a Markdown Mermaid block,
- render in a debug UI overlay,
- copy into Mermaid Live Editor.

## API

- `renderVacpDiagramMermaid({ capabilities, state?, options? })`
- `renderVacpGraphMermaid({ graph, state? }, options?)`
