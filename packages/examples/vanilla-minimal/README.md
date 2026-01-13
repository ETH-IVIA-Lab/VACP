# Vanilla minimal example

This is the smallest possible “bring-your-own-provider” VACP setup:

- An SVG scatterplot rendered with plain DOM APIs (no framework).
- A selection implemented as a set of point ids.
- A DuckDB-backed `DataHandle` exposed through the standard `vacp.data_sql` action.

## Run

From the repo root:

- `pnpm -C packages/examples/vanilla-minimal dev`

## Try

- Click points to toggle selection.
- Enable the overlay (set `VACP_DEBUG_UI=1` or add `?vacp-debug=1`), then go to **Data** and run SQL like:
  - `SELECT COUNT(*) AS n FROM vacp_all`
  - `SELECT COUNT(*) AS n FROM vacp_handle`
