# React dashboard example

Example React dashboard wired to VACP via `@vacp/kit`.

## What it includes

- Dataset selector (`src/datasets/data/iris.json`, `src/datasets/data/mtcars.json`) and a registry (`src/datasets/registry.ts`) to add more.
- Encoding controls for `x`, `y`, and `color`.
- Linked *View*s:
  - Scatter plot (point toggle + 2D brush)
  - Distribution _View_ (histogram/PDF with clickable bars for bin selection)
  - Data table _View_ (TanStack Table)
- VACP bridge:
  - Semantic actions (`dashboard.*`) for dataset/encoding/_Selection_, including `dashboard.set_brush_2d`
  - DuckDB-backed _DataHandle_ via `vacp.data_sql` and `vacp.data_schema` (`vacp_all` / `vacp_handle`)

## Run

From the repo root:

- `pnpm -C packages/examples/react-dashboard dev`

## Try

- Click points to toggle _Selection_.
- Drag in the scatter to brush-select (replaces the _Selection_). Drag the brush rectangle to move it.
- Click distribution bars to select a bin (also replaces the _Selection_).
- Double-click a chart to clear _Selection_.
- Use the Distribution _View_ to inspect PDFs. _Selection_ drives the subset.
- Scroll the Data Table. _Selection_ drives the subset.
- Open the overlay with the floating **VACP** button, then run SQL like:
  - `SELECT COUNT(*) AS n FROM vacp_all`
  - `SELECT COUNT(*) AS n FROM vacp_handle`
