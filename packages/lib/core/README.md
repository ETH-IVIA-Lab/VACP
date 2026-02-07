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
- `VacpStateRequest` / `VacpStateUpdate`: optional partial/delta state retrieval contract.
- `VacpWindowBridge`: the in-page API contract (typically installed as `window.__vacp`).

If you are building a new provider, start by choosing stable refs, then emit a graph + state around them.

## Configuration (“hyper params”)

Apps and tooling in this repo support a small set of runtime knobs that can be set via:

- URL params (kebab-case), e.g. `?vacp-debug=1`
- environment variables, e.g. `VACP_DEBUG_UI=1`

The resolver lives in this package:

- `getVacpHyperParams()` / `resolveVacpHyperParams()` (see `packages/lib/core/src/hyperparams.ts`)

Currently supported:

- `debugUi`: show/hide the in-page overlay (`VACP_DEBUG_UI`, `vacp-debug`, localStorage `vacp:debug`)
- `exposeBridge`: expose/remove the JS bridge at `window.__vacp` (`VACP_EXPOSE_BRIDGE`, `expose-bridge`)
- `domSnapshot`: inject/remove the JSON DOM snapshot `<script>` (`VACP_DOM_SNAPSHOT`, `vacp-dom-snapshot`)

### Bundler note

In browser builds, env vars only exist if your bundler injects them. For Vite apps, set `envPrefix: ['VITE_', 'VACP_']`
so `import.meta.env.VACP_*` is available at runtime.
