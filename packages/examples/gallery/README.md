# vacp-example-gallery

Declarative single-process host for all example apps.

## Purpose

- Serve all example routes from one Vite process (`pnpm dev` from repo root).
- Produce static multi-page output for serverless hosting.
- Stable routes:
  - `/mosaic/`
  - `/vega-lite/`
  - `/react-dashboard/`
  - `/cars-parcoords/`

## How it works

`examples.manifest.json` drives:

- home page cards
- generated per-route HTML entry points
- adapter module loading (`src/mfe.ts` or `src/mfe.tsx` in each example package)
- route-scoped public asset copy into `.generated-public/<route>/...`

Generation runs via `node scripts/sync-generated.mjs` before `dev` and `build`.

## Commands

- `pnpm -C packages/examples/gallery dev`
- `pnpm -C packages/examples/gallery dev:full`
- `pnpm -C packages/examples/gallery build`
- `pnpm -C packages/examples/gallery preview`
