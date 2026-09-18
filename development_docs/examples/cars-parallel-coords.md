# Cars parallel coordinates

Example D3 parallel coordinates app with per-axis brushing and dimension reordering, exposed through VACP.

Implementation:

- TypeScript + Vite (no framework)
- D3 + SVG rendering
- VACP bridge at `window.__vacp` (unless `exposeBridge: false`)

## Run it

From the repo root:

```bash
pnpm -C examples/cars-parallel-coords dev
```

Open the inspector:

- click the floating **VACP** button. Applications choose whether to call `installVacpInspector()`

## Interactions

- Brush any axis to filter to a subset of cars.
- Drag dimension labels horizontally to reorder axes.
- Use **Reset Brush** and **Reset Dimension Order** to return to defaults.

## VACP

- State:
  - per-dimension brush ranges + selected count
  - hovered row (tooltip focus)
- Actions:
  - `parallel_coords.set_brush_ranges`
  - `parallel_coords.reset_brushes`
  - `parallel_coords.set_dimension_order`
  - `parallel_coords.reset_dimension_order`
  - `parallel_coords.set_hover`
  - `parallel_coords.clear_hover`
  - `vacp.data_sql` and `vacp.data_schema` over a DuckDB-backed table (`vacp_all` / `vacp_handle`)

Local URL: `https://cars-parcoords.examples.vacp.localhost/`. Portless prints the exact URL when using a custom proxy port or git worktree.
