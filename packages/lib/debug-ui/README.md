# @vacp/debug-ui

Optional in-page debug overlay for VACP.

It is provider-agnostic: it only talks to `window.__vacp` (the runtime bridge installed by `@vacp/gateway`).

## Enable

- add `?vacpDebug=1` to the URL, or
- set localStorage `vacp:debug=1`

The overlay button (“VACP” pill) is draggable and snaps to nearby anchors (corners/edges/center). The tools panel opens
next to the pill and stays within the viewport.

## What it shows

- **Graph**: rendered graph diagram (Mermaid → SVG)
- **Data**: pick a `DataHandle` and run DuckDB SQL via `vacp.data_sql` (includes selection preview)
- **Actions**: manual dispatch (no pixel automation)
- **History**: runtime controls + timeline + time travel (inspect cursor) + apply-to-live (“rewind”)
- **Playbook**: provider-supplied scripted stepper (shows “agent-like” sequences)
- **JSON**: inspection overrides + opt-in apply-to-live

The overlay works best when the bridge supports `getRuntime()` and `getPlaybooks()` (or the older `getDemos()`), but it
still functions with the minimal bridge (`getCapabilities/getState/execute`).

For a runnable reference, see any of the example apps under `packages/examples/*`.

## Shortcuts

When the tools panel is open:

- `Esc` closes it
- `Alt+1..9` selects modules by order
- `Alt+R` captures a fresh snapshot
