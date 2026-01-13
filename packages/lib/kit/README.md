# @vacp/kit

Tiny helpers for “bring-your-own-provider” VACP integrations.

This package is intended for apps that already have their own visualization/runtime logic (React, vanilla DOM, D3, etc.)
and want to layer VACP on top without committing to a first-class provider like `@vacp/vgplot` or `@vacp/vega-lite`.

## What it provides

- `createVacpRefBuilder`: generate stable `vacp://...` refs for a view/viz namespace.
- `createVacpActions`: ergonomics for defining/registering actions (incl. standard `vacp.apply_state` and `vacp.data_sql`).
- `createVacpLayer`: “one place” installer that creates snapshots and installs the stable runtime bridge (`window.__vacp`).
- DuckDB helpers: `createDuckDbSqlRouter`, `makeVacpDuckDbTableName`.

## Minimal pattern

1. Pick stable ids (`appId`, `viewId`, optional `vizId`) and refs.
2. Define a `VacpGraphBase` (nodes/edges).
3. Register actions using `createVacpActions()`.
4. Provide `getState()` (and optional `getSummary()`).
5. Install via `createVacpLayer({ graph, actions: actions.registry, getState })`.

For runnable references, see:

- `packages/examples/vanilla-minimal`
- `packages/examples/d3-scatter-lasso`
- `packages/examples/react-dashboard`

