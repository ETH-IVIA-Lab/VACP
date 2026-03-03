# Debug overlay

The debug overlay is the fastest way to validate an integration. It reads the same snapshots and executes the same actions an agent would.
The implementation in this repo is `@vacp/debug-ui` under `packages/lib/tooling/debug-ui`.

## Enable

Add `?vacp-debug=1` to the URL. For local development you can set `VACP_DEBUG_UI=1` when starting the dev server.

## What to check

Start with the capabilities graph. Nodes should correspond to real semantic entities. Actions should be named and scoped.

Interact with the app and watch the state snapshot change. A selection should update when you brush. A parameter should update when you change a control.

Dispatch an action from the overlay and confirm the interface updates. Then read state again to verify the change.

If runtime history is enabled, inspect the sequence of transitions and replay a step to confirm it is deterministic.
