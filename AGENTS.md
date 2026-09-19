# Working on VACP

VACP composes analytical sources, state, freshness, and semantic operations through transport-neutral providers and an in-page bridge. Preserve the shared human/agent interaction model and its history semantics.

## Workspace

- `packages/protocol`: protocol records, runtime contracts, and shared primitives.
- `packages/runtime`: action registration, snapshots, state deltas, and history.
- `packages/runtime-browser`: explicit browser exposure, global bridge installation, and DOM snapshots.
- `packages/transport-bridge`: model-independent bridge-to-tool mapping.
- `packages/transport-webmcp`: graph projection and optional browser-native tool registration.
- `packages/data-duckdb`: SQL and data adapters.
- `packages/sdk`: application integration helpers.
- `packages/adapter-vega-lite`, `packages/adapter-vgplot`: visualization providers.
- `packages/agent-ai-sdk`, `packages/python`: model orchestration and MCP transport.
- `packages/presence-core`: headless agent activity, semantic target resolution, and presentation ports.
- `packages/presence-browser`: optional cursor rendering and browser geometry helpers.
- `packages/inspector-core`: viewer contracts, local history, and client connections.
- `packages/diagram-mermaid`, `packages/analytics`: graph rendering and telemetry.
- `packages/analytics-posthog`: PostHog implementation of the telemetry provider port.
- `vite.shared.ts`: shared Vite configuration for applications.
- `examples/gallery`: gallery composition and generated routes.
- `examples/cars-parallel-coords`, `examples/react-dashboard`, `examples/vega-lite-gallery`, `examples/vgplot-gallery`: runnable examples.
- `apps/e2e`: Playwright tests through the browser and public bridge.
- `docs/`: user-facing guides and API reference.
- `apps/docs`: VitePress configuration, theme, and public assets.
- `development_docs/`: architecture, contributing, and testing guides.

Use capability families for package names: `adapter-*` for visualization adapters, `diagram-*` for diagram formats, `analytics-*` for analytics providers, `data-*` for data backends, and `agent-*` for agent implementations. Keep `packages/` flat.

## Dependency rules

Dependencies point toward the protocol. Protocol and runtime must not read window, document, URL configuration, or browser storage. Protocol must remain independent of providers, transports, UI frameworks, and applications. Runtime owns snapshot, action, and history behavior against its snapshot and action contracts. Providers translate their visualization's state and actions into those contracts.

Applications compose providers, transports, and optional UI. Pass exposure and SQL policy explicitly. Library packages must not read URL flags, environment variables, or browser storage to choose capabilities. Example context profiles belong under `examples/`. Connect custom inspection surfaces through an explicit `InspectorClient`. Keep request state and optional history in `inspector-core`. Presentation, selection, and navigation belong to the consuming surface. Inspection must not mutate the source. Restoration is a separate, explicitly supplied capability. Keep UI dependencies out of `@vacp/sdk`. Libraries must not import applications or another package's private source paths. Declare workspace dependencies in the importing package and use its exported API.

Add an integration as a focused provider implementing the source, projection, observation, and operation ports. Compose sources by stable source ID and keep one owner for every node and action. Discovery adapters may infer mechanical facts. Analytical meaning belongs in library or application profiles. Runtime extensions use capability subscriptions and the runtime lifetime signal. Keep target-platform registration and metadata in their own transport package. Keep provider-specific branches in the provider. Avoid compatibility aliases and parallel APIs when replacing a contract.

## Commands

Run from the repository root:

```bash
corepack enable
make setup
make build check
make browser-install e2e
```

`pnpm dev` starts the gallery at `https://examples.vacp.localhost`. `make docs-serve` serves `https://docs.vacp.localhost`. `make dev-all` starts these plus the standalone `*.examples.vacp.localhost` apps. Names live in each app's `package.json` under `portless`. Vite+ receives its port from Portless. VitePress reads `PORT` in its config. Preserve the `PORTLESS=0` bypass and explicit ports in the Playwright server helper. Use `pnpm --filter <package-name> <script>` for focused work. Vite+ owns JavaScript task orchestration, formatting, linting, and application builds. Vite+ Pack emits library JavaScript and declarations. TypeScript checks source without emitting files. uv owns the Python workspace and Ruff, ty, basedpyright, pyrefly, and pytest tools. The root Makefile defines the workflows; pnpm scripts and GitHub Actions call those targets. Run `make help` for focused commands.

## Python QA

The root `pyproject.toml` owns the shared Python dev dependencies and configurations for pytest, Ruff, ty, basedpyright, and pyrefly. Do not duplicate these in workspace members. All Python source and tests are checked from the root against the same environment and Python version.

Use `make python-check` for all Python gates, or `make python-lint`, `make python-typecheck`, and `make python-test` for focused checks. `make check` and CI invoke these same targets once. Python-only packages are managed by uv. They do not need npm task wrappers.

## TypeScript imports and builds

Use extensionless relative imports and re-exports in owned TypeScript source, including type imports: `./types` and `./Component`. Workspace dependencies use public package exports such as `@vacp/protocol`. Keep actual asset filenames and vendored source conventions intact.

The root `vite.config.ts` owns library packaging policy. Each library runs `vp pack`, which inherits that configuration, preserves module structure with `unbundle`, and emits Node-compatible ESM and declarations. `tsconfig.base.json` owns no-emit type checking with bundler resolution. Vite+ orders package tasks using the pnpm workspace dependency graph. Do not add import-rewriting scripts, custom loaders, or source aliases for package consumers.

`make test-package-imports` exercises every JavaScript package export in native Node and a strict NodeNext TypeScript consumer using the built declarations. Keep this check working alongside browser builds when changing imports, exports, or compiler options. Public declaration dependencies belong in the declaring package's dependencies.

## Public types and validation

Preserve application types with generics in action, snapshot, and transport contracts. Use `unknown` where input is actually unvalidated, then narrow it at the receiving boundary. Avoid generic parameters that only disguise unchecked assertions. Custom actions and schema description fields must stay open. Do not require index signatures on domain interfaces or introduce schema generation. Zod 4 is available for runtime validation.

The vendored anti-slop sources remain unchanged. Local rule choices live in `tools/oxlint/anti-slop/preset.ts`; follow the documented preset rather than adding per-line exceptions. Knip checks dependencies and exports across the shared workspace.

## Behavioral boundaries

- Providers describe the full catalog and current availability. Use explicit node prerequisites and host readiness reasons; do not infer prerequisites from containment or effects. Keep disclosure and execution guards in the shared protocol resolver. Agent reads disclose the current surface; inspection reads retain the catalog. Python and TypeScript availability semantics share conformance fixtures.

- Preparation validates every supplied input and resolves its native target before mutation. Retain normalized values and the target in a single-use execution closure. Recheck lifetime before applying effects. Runtime errors can still occur after preparation. Report partial effects honestly.
- Share one adapter-local binding inventory across discovery, state, execution, restoration, and optional presentation. Keep compiler names, native unit scopes, selection plumbing, and coordinate transforms inside the adapter. Consumers use refs. They do not decode paths to rediscover native objects.
- Observation must preserve native behavior, return values, promise identity, rendering, and ownership. Prefer host subscriptions. When instrumentation is necessary, one shared connection owns each resource and fans out to consumers. Detach only owned hooks, including on failed setup. Borrowing a visualization never grants permission to finalize it.
- Distinguish operation completion, output freshness, and visual arrival. Claim current outputs only from a native revision or settlement witness. Missing freshness means unknown. Elapsed time does not establish settlement. Rendering errors must not trigger a second mutation through another route.
- The runtime owns live observations and recording. Each viewer owns historical selection. Restoration is an explicit operation against live sources, with visible results and cancellation. Multiple viewers must remain independent.
- Passive observation ports grant no execution authority. Hosts supply optional pacing separately. Presentation waits are bounded, disposable, and cannot change a known action result. Pacing does not serialize otherwise concurrent operations.
- Examples remain ordinary analytical applications with a thin VACP integration. Put automation, diagnostic controls, and recording drivers in test tooling or ignored local artifacts. Add packages for independent consumers or dependency boundaries, not to distribute one responsibility across more files.

See [architecture.md](development_docs/architecture.md) for these ownership contracts and [testing.md](development_docs/testing.md) for their verification boundaries.

## Change and validation discipline

Read the package's implementation and consumers before changing a contract. Update documentation, examples, fixtures, and tests in the same change. Search for stale imports and paths after relocation. Keep package manifests, TypeScript references, and both lockfiles aligned.

Test observable behavior through exported APIs and browser interactions. For visualization changes, run the affected Playwright cases and inspect browser output in a fresh session. Assert native rows, controls, marks, and geometry against independent renderer evidence; successful action envelopes and self-reported precision are insufficient. Keep recordings paired with the exact scenario results and promote artifacts only after their assertions succeed. For packaging changes, build from the workspace root and check the packaged output. Keep external model calls out of default tests.

Edit gallery route generation in `examples/gallery/scripts/sync-generated.mjs`, not its generated HTML or copied assets. Keep generated output, browser reports, and local credentials out of version control. Do not run dependency upgrades, publish artifacts, or contact external model endpoints unless the task requests it.

CI runs the same checks and tests. Docker publishing is restricted to the main branch or manual dispatch. See `development_docs/contributing.md` for local commands and `development_docs/architecture.md` for runtime contracts.
