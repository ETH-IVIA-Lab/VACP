# Cars parallel coordinates

VACP + D3 parallel coordinates with per-axis brushing and dimension reordering.

This example is “boring tech”:

- no framework (TypeScript + Vite)
- D3 rendering in SVG
- a VACP bridge at `window.__vacp` (unless `?expose-bridge=0`)

## Run it

From the repo root:

```bash
pnpm -C packages/examples/cars-parallel-coords dev
```

Enable the debug overlay:

- set `VACP_DEBUG_UI=1` or add `?vacp-debug=1` to the URL, then click the floating **VACP** button

## Interactions

- Brush any axis to filter to a subset of cars.
- Drag dimension labels horizontally to reorder axes.
- Use **Reset Brush** and **Reset Dimension Order** to return to defaults.

## VACP

- Selection state: per-dimension brush ranges + selected count.
- Actions:
  - `parallel_coords.set_brush_ranges`
  - `parallel_coords.reset_brushes`
  - `parallel_coords.set_dimension_order`
  - `parallel_coords.reset_dimension_order`
  - `vacp.data_sql` over a DuckDB-backed table (`vacp_all` / `vacp_handle`)

