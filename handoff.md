# Handoff: Spec inbox → examples + QA

## Summary

- `packages/examples/vega-lite-gallery` now loads `*.vl.json` specs (no TS-generated specs) and serves required Vega Editor datasets under `/data/`.
- `@vacp/vega-lite` now discovers nested Vega-Lite `params` (layer/vconcat/etc.), so selections/actions/state work for real-world specs.
- Added new workspace example `packages/examples/cars-parallel-coords` (Vite + TS) with a VACP layer + DuckDB `vacp.data_sql`.
- `packages/examples/cars-parallel-coords` is now visually matched to `nogit/cars/` (and lazy-loads `@vacp/debug-ui` so baseline styling is unchanged).
- Examples hub now includes `/cars-parcoords/`.

## Run

- Vega-Lite gallery: `pnpm -C packages/examples/vega-lite-gallery dev`
- Cars parallel coordinates: `pnpm dev:cars` (or `pnpm -C packages/examples/cars-parallel-coords dev`)
- Examples hub (all demos): `pnpm dev:examples` → `http://127.0.0.1:5173/`

## Manual QA (agent-browser)

Artifacts: `.artifacts/agent-browser/spec-inbox/`

### `packages/examples/vega-lite-gallery`

- Airports:
  - Verified render and local data loads.
  - VACP: `vega_lite.set_selection` set `org` to `SEA`, then `vega_lite.clear_selection`.
  - Screenshots:
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-airports.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-airports-sea.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-airports-cleared.png`
- Seattle Weather:
  - Verified render and local data loads.
  - VACP: `click` selection set to `rain`.
  - Human brush created `brush` range; then VACP `clear_selection` + `set_selection` re-applied the same range.
  - Screenshots:
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-seattle-weather.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-seattle-weather-click-rain.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-seattle-weather-brush-human.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-seattle-weather-brush-cleared.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-seattle-weather-brush-vacp.png`
- Global Development:
  - Verified render and local data loads.
  - VACP: `current_year` set to `2005`; `view` interval set/cleared (scale-bound zoom).
  - Screenshots:
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-global-development.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-global-development-year-2005.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-global-development-zoom-vacp.png`
    - `.artifacts/agent-browser/spec-inbox/vl-gallery-global-development-zoom-cleared.png`

### `packages/examples/cars-parallel-coords`

- Verified render, brush interaction, dimension reordering, and reset buttons.
- VACP: `parallel_coords.set_brush_ranges`, `parallel_coords.reset_brushes`, `parallel_coords.set_dimension_order`, `parallel_coords.reset_dimension_order`.
- DuckDB: `vacp.data_sql` used to count `vacp_all` vs `vacp_handle` after brushing.
- Screenshots:
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-initial.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-brush-human.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-brush-reset.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-reorder-human.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-reorder-reset.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-brush-vacp.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-brush-vacp-reset.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-reorder-vacp.png`
  - `.artifacts/agent-browser/spec-inbox/cars-parcoords-reorder-vacp-reset.png`

### Cars aesthetics (`nogit/cars` parity)

Artifacts: `.artifacts/agent-browser/cars-style/`

- Original: `.artifacts/agent-browser/cars-style/original.png`
- Ported (final): `.artifacts/agent-browser/cars-style/ported-final.png`
- Pixel diff (amplified): `.artifacts/agent-browser/cars-style/diff-final.png`

### Examples hub routes

Artifacts: `.artifacts/agent-browser/examples-hub/`

- Hub index: `.artifacts/agent-browser/examples-hub/index.png`
- Routes:
  - `.artifacts/agent-browser/examples-hub/mosaic.png`
  - `.artifacts/agent-browser/examples-hub/vega-lite.png`
  - `.artifacts/agent-browser/examples-hub/d3-lasso.png`
  - `.artifacts/agent-browser/examples-hub/vanilla.png`
  - `.artifacts/agent-browser/examples-hub/react-dashboard.png`
  - `.artifacts/agent-browser/examples-hub/cars-parcoords.png`
  - `.artifacts/agent-browser/examples-hub/cars-parcoords-debug.png`

## Notes

- `agent-browser network requests --clear` appears to require `--filter ""` in this environment (otherwise it errors on a null filter).
