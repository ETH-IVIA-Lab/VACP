# vacp-example-index

Declarative single-process host for all example apps.

## Purpose

- Serve all example routes from one Vite process (`pnpm dev` from repo root).
- Produce static multi-page output for serverless hosting.
- Stable routes:
  - `/vgplot/`
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

- `pnpm -C packages/examples/index dev`
- `pnpm -C packages/examples/index dev:full`
- `pnpm -C packages/examples/index build`
- `pnpm -C packages/examples/index preview`
