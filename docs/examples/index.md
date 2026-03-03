# Examples

Runnable example apps live under `packages/examples/*`. They serve two purposes.

They are reference integrations for providers and host shells. They are also smoke test targets for evaluation.

Current example packages:

- `packages/examples/index` is the static gallery host.
- `packages/examples/vgplot-gallery` is the [VGPlot](https://idl.uw.edu/mosaic/vgplot/) integration.
- `packages/examples/vega-lite-gallery` is the [Vega-Lite](https://vega.github.io/vega-lite/) integration.
- `packages/examples/cars-parallel-coords` is a custom direct integration.
- `packages/examples/react-dashboard` is a React dashboard integration.

## Gallery

Run all examples from one base URL:

```bash
pnpm dev
```

## Develop an example on its own

Each example can be started directly:

```bash
pnpm -C packages/examples/vgplot-gallery dev
pnpm -C packages/examples/vega-lite-gallery dev
pnpm -C packages/examples/cars-parallel-coords dev
pnpm -C packages/examples/react-dashboard dev
```

## Add a new example

The gallery is declarative. Add an entry to `packages/examples/index/examples.manifest.json`.

Then export `mount(target)` from the example and point the manifest entry at it.
