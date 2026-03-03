# Providers

A provider maps an existing visualization runtime into VACP. It translates runtime entities like parameters, selections, and interaction primitives into stable refs, state snapshots, and actions.

VACP supports two integration paths. With direct integration you define the graph, state, and actions yourself. With provider integration you reuse the semantics that already exist in a runtime like vgplot or Vega.

## Providers in this repo

### Mosaic vgplot

The vgplot provider reads views, interactors, and selections from the vgplot runtime. It exposes them as a capabilities graph and state snapshot and registers actions that perform the same intent-level operations as a user.

See `packages/examples/mosaic-gallery`.

### Vega and Vega-Lite

The Vega provider connects to a Vega `View`. It focuses on parameters and selections and exposes actions to set and clear them under a stable contract.

See `packages/examples/vega-lite-gallery`.

## Choosing a path

Use a provider when you already have a supported runtime and want a faithful mapping with minimal glue code. Use direct integration when you have custom interactions or domain semantics that do not fit a provider.
