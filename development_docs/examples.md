# @vacp/examples

Declarative single-process host for all example apps.

## Purpose

- Serve all example routes from one Vite process (`pnpm dev` from repo root, at `https://examples.vacp.localhost`).
- Produce static multi-page output for serverless hosting.
- Stable routes:
  - `/vgplot/`
  - `/vega-lite/`
  - `/react-dashboard/`
  - `/cars-parcoords/`

## How it works

`examples.manifest.ts` drives:

- home page cards
- generated per-route HTML entry points
- lazy loading through each example package’s exported `mount` function
- route-scoped public asset copy into `.generated-public/<route>/...`

Generation runs via `node scripts/sync-generated.mjs` before `dev` and `build`.

## Commands

- `pnpm -C examples/gallery dev`
- `pnpm -C examples/gallery build`
- `pnpm -C examples/gallery preview`

For docs and every standalone example together, run `make dev-all`. See [local URLs](contributing.md#local-urls) for names and focused commands.
