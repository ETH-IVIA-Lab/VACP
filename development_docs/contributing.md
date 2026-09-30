# Contributing

Use Node.js 24.16 or newer, Corepack, and uv. The root `packageManager` field pins pnpm. JavaScript dependencies share `pnpm-lock.yaml`, and Python workspace members share `uv.lock`.

```bash
corepack enable
make setup build
make dev
```

Open `https://examples.vacp.localhost/` to use the gallery. Portless assigns backend ports and proxies the named URLs. Its version is pinned through the root pnpm catalog.

## Local URLs

| Surface              | Command                                                | URL                                               |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| Gallery              | `make dev`                                             | `https://examples.vacp.localhost`                 |
| Documentation        | `make docs-serve`                                      | `https://docs.vacp.localhost`                     |
| Vega-Lite            | `pnpm --filter @vacp/example-vega-lite-gallery dev`    | `https://vega-lite.examples.vacp.localhost`       |
| VGPlot               | `pnpm --filter @vacp/example-vgplot-gallery dev`       | `https://vgplot.examples.vacp.localhost`          |
| React dashboard      | `pnpm --filter @vacp/example-react-dashboard dev`      | `https://react-dashboard.examples.vacp.localhost` |
| Parallel coordinates | `pnpm --filter @vacp/example-cars-parallel-coords dev` | `https://cars-parcoords.examples.vacp.localhost`  |

`make dev-all` (or `pnpm dev:all`) starts all six surfaces. `make dev-status` lists active routes. Each application's `package.json` declares its `portless` name. Ctrl+C releases its development route. Production `preview` commands serve the built output directly at the URL printed by Vite or VitePress.

Portless reuses your existing proxy configuration. Its default is HTTPS on port 443; first use may prompt to trust its local CA and bind that port. A custom proxy port appears in the printed URL. Linked git worktrees receive a branch prefix automatically. See [Portless setup](https://github.com/vercel-labs/portless#http2--https) for proxy and certificate settings.

For a direct server, use `PORTLESS=0 pnpm --filter <package> dev --port <port>`. Playwright does this automatically with isolated ports. CI also tests the named routes through a separate unprivileged HTTP proxy, without modifying the machine's hosts file or certificate trust.

## Checks

```bash
make format check
make browser-install e2e
```

`make check` runs formatting, Oxlint with the local anti-slop preset, Ruff, TypeScript, ty, basedpyright, pyrefly, Knip, vendored-rule tests, and workspace unit tests. `make e2e` builds the browser targets and runs Playwright. Tests start and stop their own servers; diagnostics go under `.artifacts/` and `apps/e2e/test-results/`.

Use `make help` for the command list. The root pnpm scripts delegate to these targets. CI calls `make setup ci` and `make setup-web browser-install e2e`.

### Agent evals

`apps/evals` measures how agents use VACP on the examples: it grades page state, rendered text, and replies, and records tokens, latency, and reads per run. `make check` runs its unit tests. Eval runs call models, so they run on request: build the libraries with `make build-libs`, then follow [apps/evals/README.md](../apps/evals/README.md). A round that changes VACP reruns a flow as the next variant and compares it with the baseline on the test split.

### Source imports and library output

Use extensionless relative source imports and re-exports:

```ts
import type { InspectionObservation } from './types';
export { createInspectorSession } from './session';
```

Use package names for workspace boundaries, for example `@vacp/protocol`. Every library's `vp pack` command inherits the `pack` configuration from the root `vite.config.ts`. Its [unbundled mode](https://tsdown.dev/options/unbundle) preserves the source module structure and produces JavaScript and declaration imports that work in native Node. Vite+ manages this through its [library packaging command](https://viteplus.dev/guide/pack).

`tsconfig.base.json` configures TypeScript for no-emit checking with bundler resolution. Package type-check commands use `tsc -p`, independently of packaging, and cannot overwrite built declarations. Vite+ schedules library builds using workspace dependencies. Oxlint enforces extensionless imports for owned TypeScript modules. Asset filenames retain their extensions.

`make test-package-imports` builds libraries, imports every public JavaScript entry through its package manifest in native Node, and checks the same entries in a strict NodeNext consumer. The Node consumer runs emitted JavaScript with type stripping disabled. The type consumer verifies that declarations resolve independently of workspace source files and require no source-import compiler options. Keep ambient types referenced by public declarations in package dependencies.

### Lint policy

Anti-slop rules are vendored unchanged under `tools/oxlint/anti-slop`. The local `preset.ts` disables blanket bans on boundary `unknown`, runtime narrowing, open dictionaries, ordinary assertions, conditional property spreads, and naming or spacing conventions. These restrictions otherwise force duplicated validators and obscure the public API. The remaining rules reject chained assertions, widening followed by assertion, reflection shortcuts, module mocking, repeated array passes, and accumulator copying. Strict TypeScript checks stay enabled for library code.

For focused work:

```bash
pnpm --filter @vacp/runtime test
pnpm --filter @vacp/e2e test:e2e tests/smoke
uv run --all-packages --all-groups --locked pytest packages/python/tests
pnpm --filter @vacp/docs dev
```

## Python QA

The root `pyproject.toml` declares the development tools once and configures Python QA across the workspace. `pytest-asyncio` is shared there too. Member manifests contain package metadata and runtime dependencies.

```bash
make python-check       # Ruff, ty, basedpyright, pyrefly, and pytest
make python-format      # Format Python source
make python-lint        # Lint and format check
make python-typecheck   # All three type checkers
make python-test        # Combined test suite
```

Checks cover Python source and tests under `packages`, `apps`, `examples`, and `tools`. The type checkers use Python 3.12 and the root virtual environment. `make check` and `make ci` run the same gates without per-package duplicates. Each Python command installs the locked workspace packages and dev tools as needed.

For one suite, pass its path to pytest from the root. The shared pytest configuration also handles duplicate test module names across packages.

## Structure

Applications in `apps/*` and `examples/*` compose the reusable libraries in `packages/*`. The protocol is the innermost dependency. Providers and transports implement its contracts, and applications install optional inspection UI. See [AGENTS.md](../AGENTS.md) for package ownership and [development_docs/architecture.md](architecture.md) for the runtime model.

Vite+ configuration lives in `vite.config.ts`. Shared application configuration lives in `vite.shared.ts`. Keep application configuration declarative and declare workspace dependencies explicitly.

## Dependency updates

```bash
corepack use pnpm@latest
pnpm -r update
uv lock --upgrade
uv sync --all-packages --all-groups --locked
```

Validate builds, checks, unit tests, and browser tests after upgrades. Commit both lockfiles with the manifest changes.

## CI and deployment

CI builds the workspace, checks formatting, lint and types, runs unit and browser tests, and builds Python distributions. The image publishing workflow runs after successful main-branch CI or a manual main-branch dispatch. It publishes documentation and gallery images to the configured Harbor registry, tagged with the tested commit SHA and `latest`. Registry credentials are GitHub Actions secrets.

## Documentation

Write user guides and API references in `docs/`. VitePress configuration, theme, and public assets live in `apps/docs/`. Keep architecture, development, and operational material in `development_docs/`.

Run `pnpm --filter @vacp/docs dev` to preview documentation and `pnpm --filter @vacp/docs build` to check the published site. The custom integration snippet is exercised by the SDK's public-boundary test.
