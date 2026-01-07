# Vanilla minimal example

This is the smallest possible “bring-your-own-provider” VACP setup:

- An SVG scatterplot rendered with plain DOM APIs (no framework).
- A selection implemented as a set of point ids.
- A DuckDB-backed `DataHandle` exposed through the standard `vacp.data_sql` action.

## Run

From `vacp/`:

- `pnpm -C packages/examples/vanilla-minimal dev`

## Try

- Click points to toggle selection.
- Open `?vacpDebug=1`, open the overlay, then go to **Data** (added by this repo) and run SQL like:
  - `SELECT COUNT(*) AS n FROM vacp_all`
  - `SELECT COUNT(*) AS n FROM vacp_handle`
