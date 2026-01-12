# React dashboard example

React + TypeScript + Tailwind + zustand + shadcn UI + recharts, wired to VACP via `@vacp/kit`.

Features:

- Dataset dropdown (`src/datasets/data/iris.json`, `src/datasets/data/mtcars.json`) with a small registry (`src/datasets/registry.ts`) to add more datasets.
- Dynamic encoding controls for `x`, `y`, and `color`.
- Linked views:
  - Scatter plot (click to toggle; Shift+drag lasso; double-click to reset)
  - X brush view (rank plot over x-sorted rows; resizable brush; double-click to reset brush + selection)
- VACP bridge:
  - Semantic actions (`dashboard.*`) for dataset/encoding/selection/brush/lasso
  - DuckDB-backed `DataHandle` via `vacp.data_sql` (`vacp_all` / `vacp_handle`)

## Run

From the repo root:

- `pnpm dev:react-dashboard`
- or `pnpm -C packages/examples/react-dashboard dev`

## Try

- Click points to toggle selection.
- Shift+drag to lasso-select; double-click in the scatter to clear selection.
- Use the brush to filter the scatter; double-click in the brush view to reset.
- Open `?vacpDebug=1`, open the overlay, then run SQL like:
  - `SELECT COUNT(*) AS n FROM vacp_all`
  - `SELECT COUNT(*) AS n FROM vacp_handle`
