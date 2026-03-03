# @vacp/kit

## Purpose

Helpers for bring-your-own-provider VACP integrations.

`@vacp/kit` is intended for apps that already have their own visualization/runtime logic (React, vanilla DOM, D3, etc.) and want to layer VACP on top without committing to a first-class provider.

## When to use

- Your app has custom interactions and you want semantic actions/state without pixel automation.
- You are integrating VACP into a non-vgplot / non-Vega-Lite visualization stack.

## Conceptual model

- Generate stable refs for semantic entities.
- Define a capabilities graph and state snapshot keyed by refs.
- Register semantic actions that match user intent.
- Install the runtime bridge (via `@vacp/gateway`).

## Minimal usage

Most integrations follow this pattern:

1. Define stable ids and refs for your app.
2. Build a graph (nodes/edges/actions).
3. Implement `getState()`.
4. Register semantic actions.
5. Install the bridge.

## Related docs

- [Core runtime](../../../../docs/core-runtime/index.md)
- [Providers](../../../../docs/providers/index.md)
- [Configuration](../../../../docs/reference/configuration.md)
