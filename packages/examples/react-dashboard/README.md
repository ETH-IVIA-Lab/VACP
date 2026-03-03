# React dashboard example

Example React dashboard wired to VACP via `@vacp/kit`.

## What it includes

- Dataset selector (`src/datasets/data/iris.json`, `src/datasets/data/mtcars.json`) and a registry (`src/datasets/registry.ts`) to add more.
- Encoding controls for `x`, `y`, and `color`.
- Linked views:
  - Scatter plot (point toggle + 2D brush)
  - Distribution view (histogram/PDF; click bars to select a bin)
  - Data table view (TanStack Table)
- VACP bridge:
  - Semantic actions (`dashboard.*`) for dataset/encoding/selection, including `dashboard.set_brush_2d`
  - DuckDB-backed `DataHandle` via `vacp.data_sql` and `vacp.data_schema` (`vacp_all` / `vacp_handle`)

## Run

From the repo root:

- `pnpm -C packages/examples/react-dashboard dev`

## Try

- Click points to toggle selection.
- Drag in the scatter to brush-select (replaces the selection). Drag the brush rectangle to move it.
- Click distribution bars to select a bin (also replaces the selection).
- Double-click a chart to clear selection.
- Use the Distribution view to inspect PDFs; selection drives the subset.
- Scroll the Data Table; selection drives the subset.
- Enable the overlay (set `VACP_DEBUG_UI=1` or add `?vacp-debug=1`), then run SQL like:
  - `SELECT COUNT(*) AS n FROM vacp_all`
  - `SELECT COUNT(*) AS n FROM vacp_handle`
