# Testing

Tests protect behavior at the boundary a consumer uses: package exports for libraries, the page bridge and native rendering for providers, and the rendered page for presence and the docs.

| Suite           | Command                     | Covers                                                                  |
| --------------- | --------------------------- | ----------------------------------------------------------------------- |
| Unit            | `make test`                 | Each package's `test/` through its public entry, plus Python            |
| Package imports | `make test-package-imports` | Every public export in native Node and a strict NodeNext consumer       |
| Lint rules      | `make test-tools`           | The vendored anti-slop rules and the StyleX sheet compiler              |
| Browser         | `make e2e`                  | Examples, presence, WebMCP, the built gallery, and the docs             |
| Benchmarks      | `make bench`                | Hot paths, run one package at a time. See [performance](performance.md) |

Unit tests run with `node --test` and a 10-second deadline, 20 seconds for the eval suite, so a missing asynchronous signal fails instead of hanging. Timing contracts use controlled clocks and observable phases. Benchmarks are never correctness checks.

## Browser suite

`apps/e2e/playwright.config.ts` starts every application once per run on explicit ports from `tests/helpers/servers.ts`: the dev servers of the gallery and each example, the built gallery, and the built documentation. `VACP_E2E_PORT` moves the whole range, so two checkouts can run at once. The `warm` project opens each dev server first, so Vite's dependency optimization never reloads a page under test.

| Folder            | Contents                                                    |
| ----------------- | ----------------------------------------------------------- |
| `tests/bridge`    | The page bridge, presence, provenance, availability, WebMCP |
| `tests/providers` | Native Vega-Lite, vgplot, and cars behavior                 |
| `tests/examples`  | Example applications end to end                             |
| `tests/smoke`     | Every example and gallery route, Portless routing           |
| `tests/docs`      | The built documentation site                                |
| `tests/helpers`   | Servers, the test fixture, WebMCP tool calls                |

Import `test` from `helpers/test`. Its `exampleOptions` option sets `__vacpExampleOptions` before each page loads, with agent pacing off by default. Presence specs turn it on with `test.use({ exampleOptions: { paceAgentSteps: true } })`. Call `useWebMcp()` at the top of a spec that needs Chromium's WebMCP. `gotoApp(page, name, path?)` opens an application and waits for its bridge. `tool(page, suffix, params)` calls a registered WebMCP tool the way a browser agent does.

Every test gets a fresh page, runtime, and journal. Keep tests independent within a file, since they run in parallel.

## Evidence

A successful result envelope proves that the runtime dispatched the call. To prove what the person sees, assert the native outcome alongside the protocol result: table rows and page text, bound controls after a view is replaced, linked legend selections, and brush and cursor geometry against native mark bounds under SVG, Canvas, padding, scaling, and pixel density.

Keep one witness per contract at the boundary that can prove it:

- Preparation rejects invalid input before any native change, and the prepared operation runs once.
- Replacing a provider cancels its old binding. Replacing an unrelated source leaves active work alone.
- Attaching and detaching observation preserves native controls, rendering, return values, and promise identity, in either order. Failed setup releases what it acquired.
- Freshness belongs to an input and output revision, and superseded work never publishes as current.
- Viewers inspect recorded observations independently, and only explicit restoration changes the source.
- Viewers need no timing authority, and released pacing leaves them attached.

Validate a visualization change in a fresh browser session. Record short videos early to inspect motion, keep each recording with its scenario and assertions in ignored artifacts, and keep a recording only after its assertions pass.

## Network

DuckDB-Wasm downloads the parquet, spatial, and other extensions from `extensions.duckdb.org` on first use. Pages opened through the shared `test` fixture fetch each extension once, with retries, and then read it from `apps/e2e/node_modules/.cache/duckdb-extensions`. The vgplot gallery's `gaia`, `nyc-taxi-rides`, and `observable-latency` specifications still stream remote data, so a slow bucket can stall them. Rerun a single stalled spec before treating it as a failure.
