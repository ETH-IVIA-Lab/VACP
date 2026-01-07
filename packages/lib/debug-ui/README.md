# @vacp/debug-ui

Optional in-page debug overlay for VACP.

It is provider-agnostic: it only talks to `window.__vacp` (the runtime bridge installed by `@vacp/gateway`).

## Enable

- add `?vacpDebug=1` to the URL, or
- set localStorage `vacp:debug=1`

The overlay can be dragged by the “VACP” pill (closed) or by the title bar (open). When released, it snaps to a nearby
anchor (corners/edges/center).

## What it shows

- **Graph**: current graph rendered as Mermaid → SVG (plus Mermaid source)
- **Data**: pick a `DataHandle` and run DuckDB SQL via `vacp.data_sql` (includes selection preview)
- **Actions**: manual dispatch (no pixel automation)
- **History**: runtime timeline + time travel (live/undo/redo)
- **Demo**: provider-supplied scripted stepper (shows “agent-like” sequences)
- **JSON**: inspection overrides + opt-in apply-to-live

The overlay works best when the bridge supports `getRuntime()` and `getDemos()`, but it still functions with the minimal bridge (`getCapabilities/getState/execute`).

For a runnable reference, see any of the example apps under `packages/examples/*`.
