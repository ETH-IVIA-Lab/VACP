# React dashboard example

React + TypeScript + Tailwind + zustand + shadcn UI + recharts, wired to VACP via `@vacp/kit`.

Features:

- Dataset dropdown (`src/datasets/data/iris.json`, `src/datasets/data/mtcars.json`) with a small registry (`src/datasets/registry.ts`) to add more datasets.
- Dynamic encoding controls for `x`, `y`, and `color`.
- Linked views:
  - Scatter plot (click to toggle; drag 2D brush to replace selection; drag brush to move)
  - Distribution (PDF) view (x/y side-by-side; click bars to select a bin)
  - Data table view (TanStack Table; shows selection when present)
- VACP bridge:
  - Semantic actions (`dashboard.*`) for dataset/encoding/selection and 2D brush (`dashboard.set_brush_2d`)
  - DuckDB-backed `DataHandle` via `vacp.data_sql` (`vacp_all` / `vacp_handle`)

## Run

From the repo root:

- `pnpm dev:react-dashboard`
- or `pnpm -C packages/examples/react-dashboard dev`

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
