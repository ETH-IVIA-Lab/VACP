# Inspector

The VACP Inspector lets you explore a visualization’s semantic graph, query its data, run actions, replay history, and work with an agent in Chat. It uses the same capabilities, state, and action contract as agent integrations.

## Open

The example apps call `installVacpInspector` from `@vacp/inspector`, which mounts the overlay when the overlay flag is enabled. Click the floating **VACP** control to open it.

Disable it with `?vacp-inspector=0` or `VACP_INSPECTOR=0`. Use the Settings tab to inspect the active flags and store browser-level overrides.

## Explore and interact

Start with the capabilities graph. Select a node to inspect its semantic identity and relationships. Open Actions to see the operations available for the visualization.

Interact with the app and watch the state snapshot change. A _Selection_ should update when you brush. A _Param_ should update when you change a control.

Dispatch an action from the overlay and confirm the interface updates. Then read state again to verify the change.

If runtime history is enabled, inspect the sequence of transitions and replay a step to confirm it is deterministic.

In the Chat tab, inspect the tool trace as executed. If the client normalizes an invalid or overly broad request before dispatch, the trace should show the effective input rather than only the raw requested input.
