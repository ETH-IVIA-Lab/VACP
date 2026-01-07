# @vacp/debug-ui

Optional in-page debug overlay for VACP.

It is provider-agnostic: it only talks to `window.__vacp` (the runtime bridge installed by `@vacp/gateway`).

## Enable

- add `?vacpDebug=1` to the URL, or
- set localStorage `vacp:debug=1`

## What it shows

- current graph rendered as Mermaid → SVG
- available actions and manual dispatch (with source + message)
- timeline/history + time travel inspection (live/undo/redo)
- inspection-only state/graph overrides (do not mutate the live app)
