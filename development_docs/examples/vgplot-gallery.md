# VGPlot gallery

VACP + VGPlot.

This example exposes a VGPlot dashboard through VACP by installing a bridge at `window.__vacp` (unless
`exposeBridge: false`).

Use this example to see:

- linked *View*s (crossfilter)
- VGPlot interactors (brushes, toggles, menus)
- human/agent bidirectional control (mouse interactions and semantic actions produce compatible state)

The gallery loads the YAML specs in `src/specs/` and renders them as a simple gallery.

Highlights include:

- Olympic Athletes
- Crossfilter (Flights)
- Flights Hexbin
- Line Multi-Series
- Normalized Stock Prices
- NYC Taxi Rides
- Pan & Zoom
- Seattle Weather
- U.S. States
- WNBA Shot Chart

## Run it

From the repo root:

```bash
pnpm -C examples/vgplot-gallery dev
```

## How it works

1. The app loads a YAML spec from `src/specs/*.yaml`.
2. VGPlot renders it into DOM/SVG (via `@uwdata/mosaic-spec` + `@uwdata/vgplot`).
3. `@vacp/adapter-vgplot` creates a provider. The application installs its runtime through `@vacp/runtime-browser`:
   - **Bridge**: installs/updates `window.__vacp` (capabilities/state/execute, unless `exposeBridge: false`)
   - **Actions**: registers semantic operations like `vgplot.set_interval_1d`, `vgplot.clear_interval_2d`, etc.
   - **DuckDB SQL**: enables `vacp.data_sql` so agents can query the current _Selection_

VACP exposes a stable, typed, app-owned API for discovery and control. It does not depend on DOM scraping or pixel-level
automation.

## Things to try

### Try it: human interaction

- Use a brush/interval _Selection_ on the chart.
- Watch how:
  - `window.__vacp.getState()` changes
  - runtime history grows

### Try it: manual action dispatch

Read action descriptors with `window.__vacp.getCapabilities()`, select the contract and source owner, then call `window.__vacp.execute({ callId, name, params })` with the selected action and its parameters.

Manual dispatch covers these checks:

- Validate action schemas.
- Reproduce an interaction deterministically.
- Compare human brush and semantic action outcomes.

## How to add or edit specs

Specs live in `src/specs/*.yaml`. Each YAML file can include a top-level `meta` block:

```yaml
meta:
  title: Crossfilter (Flights)
  description: Two linked histograms sharing a *Selection*.
```

Everything under `meta` is ignored by the VGPlot runtime and only used by the gallery UI.

## How bidirectionality is achieved

- **Human** updates the VGPlot interactor state (brush/toggle/menu).
- `@vacp/adapter-vgplot` observes/reads the current _Selection_ state and exposes it via `window.__vacp.getState()`.
- **Agent** dispatches an equivalent semantic action via `window.__vacp.execute(...)` (or `dispatch(...)` when available).
- Both paths record into the same runtime history so inspection sees both kinds of interaction.

## Entry points

- App wiring: `src/app.ts`
- Specs + metadata: `src/specs/`

Local URL: `https://vgplot.examples.vacp.localhost/`. Portless prints the exact URL when using a custom proxy port or git worktree.
