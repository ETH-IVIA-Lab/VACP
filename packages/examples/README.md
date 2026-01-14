# Examples

Runnable example apps (similar in spirit to `mosaic/packages/examples/*`).

- `mosaic-gallery`: Mosaic spec gallery (YAML in `src/specs/`) installed via `@vacp/vgplot`
- `vega-lite-gallery`: Vega-Lite spec gallery (modules in `src/specs/`) installed via `@vacp/vega-lite`
- `d3-scatter-lasso`: Frameworkless D3 scatter with lasso selection (a “bring-your-own-provider” integration using `@vacp/kit`)
- `vanilla-minimal`: The smallest possible “bring-your-own-provider” example (plain SVG + click selection + `vacp.data_sql`)
- `react-dashboard`: React + Zustand + shadcn UI + recharts dashboard (a “bring-your-own-provider” integration using `@vacp/kit`)

Each example package has its own tutorial README:

- `packages/examples/mosaic-gallery/README.md`
- `packages/examples/vega-lite-gallery/README.md`
- `packages/examples/d3-scatter-lasso/README.md`
- `packages/examples/vanilla-minimal/README.md`
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
  - `pnpm dev:d3-lasso`
  - `pnpm dev:vanilla`
  - `pnpm dev:react-dashboard`
- Run all (hub, one port): `pnpm dev:examples`
  - `http://127.0.0.1:5173/mosaic/`
  - `http://127.0.0.1:5173/vega-lite/`
  - `http://127.0.0.1:5173/d3-lasso/`
  - `http://127.0.0.1:5173/vanilla/`
  - `http://127.0.0.1:5173/react-dashboard/`
- Run (direct): `pnpm -C packages/examples/<example> dev` (see folder names above)

### Config knobs

- Overlay: `VACP_DEBUG_UI=0|1` or `?vacp-debug=0|1` (also supports localStorage `vacp:debug=1`).
- DOM snapshot injection: `VACP_DOM_SNAPSHOT=0|1` or `?vacp-dom-snapshot=0|1`.
