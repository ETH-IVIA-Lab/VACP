# Examples

## Purpose

Runnable example apps used for development and Playwright smoke tests (`pnpm test`).

## When to use

- You want a concrete reference for how VACP integrates with different visualization stacks.
- You want stable demo routes for evaluation and regression tests.

## Conceptual model

- Each example is independently runnable.
- The unified gallery serves all examples from one base URL with stable routes.
- The gallery is declarative via `packages/examples/index/examples.manifest.json`.

## Minimal usage

From repo root:

- Start unified gallery: `pnpm dev`

Individual examples:

- `pnpm -C packages/examples/vgplot-gallery dev`
- `pnpm -C packages/examples/vega-lite-gallery dev`
- `pnpm -C packages/examples/cars-parallel-coords dev`
- `pnpm -C packages/examples/react-dashboard dev`

## Related docs

- [Examples](../../docs/examples/index.md)
- [Get started](../../docs/get-started/index.md)
- [Providers](../../docs/providers/index.md)
