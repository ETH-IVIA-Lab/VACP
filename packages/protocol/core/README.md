# @vacp/core

Protocol types for VACP.

This package is intentionally dependency-free. It defines the stable JSON shapes that:

- apps produce (capabilities + state snapshots),
- tools consume (debug UI, tests),
- transports forward (e.g. MCP).

## Concepts

- `VacpGraph`: nodes/edges that describe “what exists” in the UI.
- `VacpActionDescriptor`: semantic actions an agent can call (not DOM events).
- `VacpStateSnapshot`: current values keyed by stable `vacp://...` refs.
- `VacpWindowBridge`: the in-page API contract (typically installed as `window.__vacp`).

If you are building a new provider, start by choosing stable refs, then emit a graph + state around them.
