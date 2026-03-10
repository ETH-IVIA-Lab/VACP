# Providers

A provider maps an existing visualization runtime into VACP. It translates runtime entities like *Param*s, *Selection*s, and interaction primitives into stable refs, state snapshots, and actions.

VACP supports two integration paths. With direct integration you define the graph, state, and actions yourself. With provider integration you reuse semantics that already exist in a runtime.

## Providers in this repo

### VGPlot

The VGPlot provider reads *View*s, interactors, and *Selection*s from [Mosaic VGPlot](https://idl.uw.edu/mosaic/vgplot/). It exposes them as a capabilities graph and state snapshot and registers actions that perform the same intent-level operations as a user.

Package: `@vacp/vgplot` in `packages/lib/providers/vgplot`.
Example: `packages/examples/vgplot-gallery`.

### Vega-Lite

The Vega-Lite provider targets [Vega-Lite](https://vega.github.io/vega-lite/) specs by connecting to a Vega _View_ ([API](https://vega.github.io/vega/docs/api/view/)). It focuses on *Param*s and *Selection*s and exposes actions to set and clear them under a stable contract.

Package: `@vacp/vega-lite` in `packages/lib/providers/vega-lite`.
Example: `packages/examples/vega-lite-gallery`.

## Choosing a path

Use a provider when you already have a supported runtime and want a faithful mapping with minimal glue code. Use direct integration when you have custom interactions or domain semantics that do not fit a provider.
