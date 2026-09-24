# @vacp/examples

Declarative single-process host for all example apps.

## Purpose

- Serve all example routes from one Vite process (`pnpm dev` from repo root, at `https://examples.vacp.localhost`).
- Produce static multi-page output for serverless hosting.
- Stable routes:
  - `/athletes/`
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

## Static build

`pnpm --filter '@vacp/examples...' build` builds the gallery and every workspace package it uses into `examples/gallery/dist`. The folder is a plain static site: each route is a directory with its own `index.html`, so any static file server can host it. `infra/examples.Dockerfile` serves the same folder from nginx.

Every example starts DuckDB-Wasm from the engine files in `dist/assets`, through `exampleDuckDbBundles` in `examples/shared`. A browser downloads the one build it selects, about 34 MB for the exception-handling build. Serve `.wasm` files compressed to cut that transfer. Three VGPlot specs, `gaia`, `nyc-taxi-rides`, and `observable-latency`, stream their datasets from a remote bucket and need network access.

Build with `VACP_BASE_PATH=/some/path/` to host the site below the domain root.
