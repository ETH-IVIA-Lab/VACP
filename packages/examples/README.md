# Examples

Runnable example apps (similar in spirit to `mosaic/packages/examples/*`).

- `mosaic-gallery`: Mosaic spec gallery (YAML in `src/specs/`) installed via `@vacp/mosaic`
- `vega-lite-gallery`: Vega-Lite spec gallery (modules in `src/specs/`) installed via `@vacp/vega-lite`
- `d3-scatter-lasso`: Frameworkless D3 scatter with lasso selection (provider assembled directly from `@vacp/*` building blocks)

All examples include the optional `@vacp/debug-ui` overlay:

- Enable: add `?vacpDebug=1` to the URL (or set localStorage `vacp:debug=1`)
- Click the “VACP” button to inspect:
  - **Graph** (Mermaid → SVG)
  - **Actions** (manual dispatch)
  - **History** (time travel)
  - **Demo** (scripted stepper)
  - **JSON** (inspection overrides + opt-in apply-to-live)

From `vacp/`:

- Install: `pnpm install`
- Run: `pnpm -C packages/examples/<example> dev`
