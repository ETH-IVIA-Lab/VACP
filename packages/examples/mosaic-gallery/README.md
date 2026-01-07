# Mosaic gallery

VACP + Mosaic/vgplot.

This example turns a Mosaic/vgplot dashboard into an **agent-ready** app by installing a VACP bridge at `window.__vacp`.

It’s a good starting point if you care about:

- linked views (crossfilter)
- Mosaic interactors (brushes, toggles, menus)
- “human ↔ agent” bidirectionality (the same selection can be done by mouse or by dispatching a semantic action)

The gallery includes a small, curated set of Mosaic specs:

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

From the `vacp/` repo root:

```bash
pnpm -C packages/examples/mosaic-gallery dev
```

Enable the debug overlay:

- add `?vacpDebug=1` to the URL, then click the floating **VACP** button

## How it works

1. The app loads a YAML spec from `src/specs/*.yaml`.
2. Mosaic renders it into DOM/SVG (via `@uwdata/mosaic-spec` + `@uwdata/vgplot`).
3. `@vacp/mosaic` installs VACP:
   - **Bridge**: installs/updates `window.__vacp` (capabilities/state/execute)
   - **SVG annotations**: attaches `data-vacp-*` and `data-interaction-vacp-*` attributes
   - **Embedded graph**: writes `<metadata type="application/vacp+json">…</metadata>` into the SVG
   - **Actions**: registers semantic operations like `mosaic.set_interval_1d`, `mosaic.clear_interval_2d`, etc.

The important part: **VACP is not a “UI test script”**. It is a stable, typed, app-owned API for discovery + control.

## Things to try

### Try it: human interaction

- Use a brush/interval selection on the chart.
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
  description: Two linked histograms sharing a selection.
```

Everything under `meta` is ignored by Mosaic and only used by the gallery UI.

## How bidirectionality is achieved

- **Human** updates the Mosaic interactor state (brush/toggle/menu).
- `@vacp/mosaic` observes/reads the current selection state and exposes it via `window.__vacp.getState()`.
- **Agent** dispatches an equivalent semantic action via `window.__vacp.execute(...)` (or `dispatch(...)` when available).
- Both paths record into the same runtime history so time travel/debugging works across both.

## Useful entry points

- App wiring: `src/app.ts`
- Playbook scripts: `src/playbooks.ts`
- Specs + metadata: `src/specs/`
