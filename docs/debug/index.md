# Debug overlay

The debug overlay is the fastest way to validate an integration. It reads the same snapshots and executes the same actions an agent would.
The implementation in this repo is `@vacp/debug-ui` under `packages/lib/tooling/debug-ui`.

## Open

The example apps call `installVacpDebugUI` from `@vacp/kit`, which installs `@vacp/debug-ui` when the overlay flag is enabled. Click the floating **VACP** control to open it.

Disable it with `?vacp-debug=0` or `VACP_DEBUG_UI=0`. Use the Settings tab to inspect the active flags and store browser-level overrides.

## What to check

Start with the capabilities graph. Nodes should correspond to real semantic entities. Actions should be named and scoped.

Interact with the app and watch the state snapshot change. A _Selection_ should update when you brush. A _Param_ should update when you change a control.

Dispatch an action from the overlay and confirm the interface updates. Then read state again to verify the change.

If runtime history is enabled, inspect the sequence of transitions and replay a step to confirm it is deterministic.

In the Chat tab, inspect the tool trace as executed. If the client normalizes an invalid or overly broad request before dispatch, the trace should show the effective input rather than only the raw requested input.
