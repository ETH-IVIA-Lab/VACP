# @vacp/e2e

Playwright end-to-end suite for VACP examples and runtime surfaces.

## Structure

```text
tests/
  bridge/       # window.__vacp contract + state update semantics
  debug-ui/     # overlay behavior and interaction flows
  providers/
    vega-lite/  # Vega-Lite provider-specific behavior
    vgplot/     # VGPlot provider-specific behavior
  smoke/        # cross-example integration smoke coverage
  helpers/      # shared test utilities (paths, dev server lifecycle)
```

## Naming

- Folder names carry the suite category.
- File names are concise and scenario-focused.
- Provider-specific tests live under their provider folder and do not repeat the provider name in the filename.

## Commands

```bash
pnpm --filter @vacp/e2e test
pnpm --filter @vacp/e2e typecheck
pnpm --filter @vacp/e2e lint
```
