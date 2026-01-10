# Test Report: packages/examples

This file records manual runs of each example in `packages/examples/`, including setup, commands, and outcomes.

## Environment

- Date: 2026-01-11T00:23:22+01:00
- OS: macOS 26.2 (25C56)
- Node: v25.2.1
- pnpm: 10.15.1
- Python (uv): 3.12.7
- Playwright: 1.57.0 (Chromium)

## Summary

- Passed: 4/4 examples
- Failed: 0
- Notes:
  - Automated smoke tests: `pnpm test:examples` (19 Playwright tests) passed.
  - Manual browser verification used Playwriter MCP with Vite dev servers (one example at a time).

## Results (per example)

### `mosaic-gallery`

- Start: `pnpm -C packages/examples/mosaic-gallery dev`
- Manual checks (Playwriter MCP):
  - Opened `http://localhost:5173/?vacpDebug=1`
  - Verified `window.__vacp` exists and supports `getCapabilities/getState/execute`
  - `getCapabilities()` returned a valid graph and action catalog
  - Executed `mosaic.set_input_option_index` on `.../input/0` and observed state change
  - Executed `vacp.data_sql` on `.../data/main` (`SELECT COUNT(*) AS n FROM vacp_all`) and got a result
- Notes:
  - Default spec loaded was “Aeromagnetic Survey” (sorted first by title).

### `vega-lite-gallery`

- Start: `pnpm -C packages/examples/vega-lite-gallery dev`
- Manual checks (Playwriter MCP):
  - Opened `http://localhost:5173/?vacpDebug=1`
  - Verified `window.__vacp` exists and exposes `vega_lite.*` actions
  - Executed `vega_lite.set_param` on `.../param/baseOpacity` and observed state change
  - Executed `vacp.data_sql` on `.../data/main` (`SELECT COUNT(*) AS n FROM vacp_all`) and got a result

### `d3-scatter-lasso`

- Start: `pnpm -C packages/examples/d3-scatter-lasso dev`
- Manual checks (Playwriter MCP):
  - Opened `http://localhost:5173/?vacpDebug=1`
  - Verified `window.__vacp` exists and exposes `vanilla.*` actions
  - Executed `vanilla.set_lasso_polygon` with a large bounding polygon and observed `selectedCount: 250`
  - Executed `vanilla.clear_lasso` and observed selection cleared
  - Executed `vacp.data_sql` on `.../data/points` (`SELECT COUNT(*) AS n FROM vacp_all`) and got a result

### `vanilla-minimal`

- Start: `pnpm -C packages/examples/vanilla-minimal dev`
- Manual checks (Playwriter MCP):
  - Opened `http://localhost:5173/?vacpDebug=1`
  - Verified `window.__vacp` exists and exposes `vanilla.toggle_point` / `vanilla.clear_selection`
  - Executed `vanilla.toggle_point` (`id: 1`) and observed selection state updated
  - Executed `vacp.data_sql` on `.../data/points` (`SELECT COUNT(*) AS n FROM vacp_handle`) and got a result
  - Executed `vanilla.clear_selection` and observed selection cleared

