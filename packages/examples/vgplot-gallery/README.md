# VGPlot gallery

VACP + vgplot (VGPlot runtime).

This example exposes a VGPlot dashboard through VACP by installing a bridge at `window.__vacp` (unless
`?expose-bridge=0`).

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
pnpm -C packages/examples/vgplot-gallery dev
```

Enable the debug overlay:

- set `VACP_DEBUG_UI=1` or add `?vacp-debug=1` to the URL, then click the floating **VACP** button

## How it works

1. The app loads a YAML spec from `src/specs/*.yaml`.
2. VGPlot renders it into DOM/SVG (via `@uwdata/mosaic-spec` + `@uwdata/vgplot`).
3. `@vacp/vgplot` installs VACP:
   - **Bridge**: installs/updates `window.__vacp` (capabilities/state/execute, unless `?expose-bridge=0`)
   - **Actions**: registers semantic operations like `vgplot.set_interval_1d`, `vgplot.clear_interval_2d`, etc.
   - **DuckDB SQL**: enables `vacp.data_sql` so agents can query the current _Selection_

VACP exposes a stable, typed, app-owned API for discovery and control. It does not depend on DOM scraping or pixel-level
automation.

## Things to try

### Try it: human interaction

- Use a brush/interval _Selection_ on the chart.
- Watch how:
  - `window.__vacp.getState()` changes
  - runtime history grows (debug overlay → **History**)

### Try it: agent-style actions

Use the debug overlay:

- Debug overlay → **Playbook** → **Run all**

That dispatches the same semantic actions an agent would call via MCP.

### Try it: manual action dispatch

- Debug overlay → **Actions**
- Pick an action and provide JSON params

This is useful when:

- you want to validate action schemas
- you want to reproduce an interaction deterministically
- you want to compare “human brush” vs “semantic action” outcomes

## How to add or edit specs

Specs live in `src/specs/*.yaml`. Each YAML file can include a top-level `meta` block:

```yaml
meta:
  title: Crossfilter (Flights)
  description: Two linked histograms sharing a *Selection*.
```

Everything under `meta` is ignored by the vgplot runtime and only used by the gallery UI.

## How bidirectionality is achieved

- **Human** updates the vgplot interactor state (brush/toggle/menu).
- `@vacp/vgplot` observes/reads the current _Selection_ state and exposes it via `window.__vacp.getState()`.
- **Agent** dispatches an equivalent semantic action via `window.__vacp.execute(...)` (or `dispatch(...)` when available).
- Both paths record into the same runtime history so time travel/debugging works across both.

## Useful entry points

- App wiring: `src/app.ts`
- Playbook scripts: `src/playbooks.ts` (+ helpers in `src/playbooks/`)
- Specs + metadata: `src/specs/`
