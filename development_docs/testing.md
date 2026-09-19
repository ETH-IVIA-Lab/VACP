# @vacp/e2e

Playwright end-to-end suite for VACP examples and runtime surfaces.

## Structure

```text
tests/
  docs/         # published documentation and integration snippets
  bridge/       # window.__vacp contract + state update semantics
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
pnpm test:e2e
pnpm --filter @vacp/e2e typecheck
pnpm lint
```

## Contract evidence

Keep a small set of behavior witnesses at the boundary that can prove them:

- Provider preparation rejects invalid inputs before any native mutation, retains normalized inputs, and produces a single-use execution.
- Replacing a provider cancels its old binding. Replacing an unrelated source preserves active work.
- Observation attachment and detachment preserve native controls, rendering, method results, and promise identity. Two consumers can leave in either order. The last restores owned hooks.
- Failed setup releases partial subscriptions. A subscriber exception cannot interrupt the source or other consumers.
- Freshness belongs to an input/output revision. Superseded work cannot publish a newer output as current or failed.
- Viewers can inspect different recorded observations independently. Explicit restoration alone mutates the source and reports partial failures.
- Passive viewers require no timing authority. Host-installed pacing can be released while viewers remain attached.

Runtime and presence unit tests cover orchestration with controllable promises. Adapter tests cover native resource ownership and pure preparation. Browser tests cover actual native-engine behavior: table row counts and page contents, bound controls after view replacement, linked legend selections, and brush/cursor bounds under SVG, Canvas, padding, scaling, and pixel density.

## Browser and recording discipline

Use a fresh browser session after source changes when validating an integration. Assert the actual visualization state alongside the protocol result. A returned success envelope proves dispatch. It does not prove visible rows, controls, or geometry are correct. Compare physical targets with native mark or brush bounds rather than relying on the adapter's own precision label.

Use short recordings early to inspect motion and lifecycle behavior. Keep scenario input, result assertions, browser version, and recording together in ignored artifacts. Record to temporary filenames and promote the video/result pair only after assertions succeed. Report the tested scenarios and input domain. A sweep of declared defaults is not exhaustive over arbitrary inputs.

Examples remain ordinary applications. Exercise them through public runtime/browser ports from test drivers. Keep diagnostic controls and automation outside example product flows.

## Timing and performance

Node unit-test commands use a 10-second outer deadline so a missing asynchronous signal fails the suite. Timing contracts use controlled clocks and observable phase transitions. Keep benchmark timing separate from correctness assertions.

Run `make bench` for runtime reads, inspection, WebMCP registration, native Vega parameter observations, and coalesced presence work. The shared measurement helper warms the operation and reports the median of five rounds. Runtime scenarios include both unchanged and changing observations. Benchmark operations must verify that their results completed successfully.

The runtime memory benchmark holds disposed handles across garbage collection and reports retained heap. It checks release of private history, delta caches, and provider references. Heap measurements are diagnostic, with no correctness threshold.
