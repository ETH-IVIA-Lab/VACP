# Examples

Runnable example apps (similar in spirit to `mosaic/packages/examples/*`).

- `mosaic-linear-regression`: Mosaic spec gallery (YAML in `src/specs/`) installed via `@vacp/mosaic`
- `vega-lite-params`: Vega-Lite spec gallery (modules in `src/specs/`) installed via `@vacp/vega-lite`
- `d3-lasso-scatter`: Frameworkless D3 scatter with lasso selection (provider assembled directly from `@vacp/*` building blocks)

Both examples also include the optional `@vacp/debug-ui` overlay:

- Enable: add `?vacpDebug=1` to the URL (or set localStorage `vacp:debug=1`)
- Click the “VACP” button to render the current graph as an SVG Mermaid diagram

From `vacp/`:

- Install: `pnpm install`
- Run: `pnpm -C packages/examples/<example> dev`
