# Examples

Runnable example apps live under `packages/examples/*`. They serve two purposes.

They are reference integrations for providers and host shells. They are also smoke test targets for evaluation.

## Gallery

Run all examples from one base URL:

```bash
pnpm dev
```

## Develop an example on its own

Each example can be started directly:

```bash
pnpm -C packages/examples/mosaic-gallery dev
pnpm -C packages/examples/vega-lite-gallery dev
pnpm -C packages/examples/cars-parallel-coords dev
pnpm -C packages/examples/react-dashboard dev
```

## Add a new example

The gallery is declarative. Add an entry to `packages/examples/gallery/examples.manifest.json`.

Then export `mount(target)` from the example and point the manifest entry at it.
