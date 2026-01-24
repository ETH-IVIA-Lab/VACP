# Examples

Runnable example apps used for development and Playwright smoke tests (`pnpm test:examples`).

- `mosaic-gallery`: Mosaic spec gallery (YAML in `src/specs/`) installed via `@vacp/vgplot`
- `vega-lite-gallery`: Vega-Lite spec gallery (`*.vl.json` in `src/specs/`) installed via `@vacp/vega-lite`
- `cars-parallel-coords`: D3 parallel coordinates demo (brush + reorder) using `@vacp/kit`
- `react-dashboard`: React dashboard demo using `@vacp/kit`

Each example package has its own tutorial README:

- `packages/examples/mosaic-gallery/README.md`
- `packages/examples/vega-lite-gallery/README.md`
- `packages/examples/cars-parallel-coords/README.md`
- `packages/examples/react-dashboard/README.md`

All examples include the optional `@vacp/debug-ui` overlay:

- Enable: set `VACP_DEBUG_UI=1` or add `?vacp-debug=1` to the URL (or set localStorage `vacp:debug=1`)
- Click the “VACP” button to inspect:
  - **Graph** (Mermaid → SVG)
  - **Data** (query `vacp_all` / `vacp_handle` via DuckDB)
  - **Actions** (manual dispatch)
  - **History** (time travel)
  - **Playbook** (scripted stepper)
  - **JSON** (inspection overrides + opt-in apply-to-live)

From the repo root:

- Install: `pnpm install`
- Build libs (examples depend on workspace `dist/`): `pnpm build`
- Run (shortcut):
  - `pnpm dev:mosaic`
  - `pnpm dev:vega-lite`
  - `pnpm dev:cars`
  - `pnpm dev:react-dashboard`
- Run all (hub, one port): `pnpm dev:examples`
  - `http://127.0.0.1:5173/mosaic/`
  - `http://127.0.0.1:5173/vega-lite/`
  - `http://127.0.0.1:5173/react-dashboard/`
  - `http://127.0.0.1:5173/cars-parcoords/`
- Run (direct): `pnpm -C packages/examples/<example> dev` (see folder names above)

### Why the hub exists

`pnpm dev:examples` serves all examples under one base URL (`http://127.0.0.1:5173/`) with stable routes.

This makes it easier to run automated evaluation across multiple demos without managing per-example ports.

### Config knobs

- Overlay: `VACP_DEBUG_UI=0|1` or `?vacp-debug=0|1` (also supports localStorage `vacp:debug=1`).
- Bridge exposure (controls whether `window.__vacp` exists at all): `VACP_EXPOSE_BRIDGE=0|1` or `?expose-bridge=0|1`.
- DOM snapshot injection: `VACP_DOM_SNAPSHOT=0|1` or `?vacp-dom-snapshot=0|1`.
