# Examples

Runnable VACP integrations live here. They depend on reusable packages through workspace imports.

- `gallery`: serves the examples from one application, including generated route entry points and copied public assets.
- `shared`: the composition every example uses. `installExampleRuntime` installs the runtime, presence with replay, WebMCP tools, and analytics until an abort signal fires. `mountSpecGallery` renders the spec picker of the two galleries, and `@vacp/example-shared/config` holds the example options.
- `vgplot-gallery`: VGPlot plots, tables, and linked interactions.
- `vega-lite-gallery`: Vega-Lite parameters and selections.
- `cars-parallel-coords`: custom D3 integration.
- `react-dashboard`: custom React integration.
- `custom-integration/threshold.ts`: the tested example included in the public integration guide.

Run `pnpm dev` from the repository root to start the gallery at `https://examples.vacp.localhost`. `make dev-all` starts docs and every example, with individual examples at `https://<name>.examples.vacp.localhost`. Use `pnpm -C examples/<name> dev` for an individual application.

See the [example development guide](../development_docs/examples.md) to add a gallery entry.
