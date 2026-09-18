# Working on VACP

VACP exposes visualization capabilities, state, and semantic actions through an in-page bridge. Preserve the shared human/agent interaction model and its history semantics.

## Workspace

- `packages/protocol`: protocol records, runtime contracts, and shared primitives.
- `packages/runtime`: action registration, snapshots, state deltas, and history.
- `packages/runtime-browser`: browser options, global bridge installation, and DOM snapshots.
- `packages/transport-bridge`: model-independent bridge-to-tool mapping.
- `packages/transport-webmcp`: graph projection and optional browser-native tool registration.
- `packages/data-duckdb`: SQL and data adapters.
- `packages/sdk`: application integration helpers.
- `packages/adapter-vega-lite`, `packages/adapter-vgplot`: visualization providers.
- `packages/agent-ai-sdk`, `packages/python`: model orchestration and MCP transport.
- `packages/inspector`, `packages/diagram-mermaid`, `packages/analytics`: inspection and telemetry.
- `packages/analytics-posthog`: PostHog implementation of the telemetry provider port.
- `vite.shared.ts`: shared Vite configuration for applications.
- `examples/gallery`: gallery composition and generated routes.
- `examples/cars-parallel-coords`, `examples/react-dashboard`, `examples/vega-lite-gallery`, `examples/vgplot-gallery`: runnable examples.
- `apps/e2e`: Playwright tests through the browser and public bridge.
- `docs/`: user-facing guides and API reference.
- `apps/docs`: VitePress configuration, theme, and public assets.
- `development_docs/`: architecture, contributing, and testing guides.
- `evals/agent-arena`, `evals/plain-mcp`, `evals/arena-analysis`: evaluation applications.

Evaluation documentation and fixtures belong under `evals/`. Keep evaluation in the root pnpm and uv workspaces with shared lockfiles. Do not create nested workspaces.

Use capability families for package names: `adapter-*` for visualization adapters, `diagram-*` for diagram formats, `analytics-*` for analytics providers, `data-*` for data backends, and `agent-*` for agent implementations. Keep `packages/` flat.

## Dependency rules

Dependencies point toward the protocol. Protocol and runtime must not read window, document, URL configuration, or browser storage. Protocol must remain independent of providers, transports, UI frameworks, and applications. Runtime owns snapshot, action, and history behavior against its snapshot and action contracts. Providers translate their visualization's state and actions into those contracts.

Applications compose providers, transports, and optional UI. Install the inspector from `@vacp/inspector` at the application boundary. Keep UI dependencies out of `@vacp/sdk`. Libraries must not import applications or another package's private source paths. Declare workspace dependencies in the importing package and use its exported API.

Add an integration as a focused adapter implementing existing ports. Introduce a new port in its consuming inner package when the existing contract cannot express the behavior. Runtime extensions use capability subscriptions and the runtime lifetime signal; keep target-platform registration and metadata in their own transport package. Keep provider-specific branches in the provider. Avoid compatibility aliases and parallel APIs when replacing a contract.

## Commands

Run from the repository root:

```bash
corepack enable
make setup
make build check
make browser-install e2e
```

`pnpm dev` starts the gallery at `https://examples.vacp.localhost`; `make docs-serve` serves `https://docs.vacp.localhost`. `make dev-all` starts these plus the standalone `*.examples.vacp.localhost` apps. Names live in each app's `package.json` under `portless`. Vite+ receives its port from Portless; VitePress reads `PORT` in its config. Preserve the `PORTLESS=0` bypass and explicit ports in the Playwright server helper. Use `pnpm --filter <package-name> <script>` for focused work. Vite+ owns JavaScript task orchestration, formatting, linting, and application builds. TypeScript owns library declarations. uv owns the Python workspace and Ruff, ty, basedpyright, pyrefly, and pytest tools. The root Makefile defines the workflows; pnpm scripts and GitHub Actions call those targets. Run `make help` for focused commands.

## Python QA

The root `pyproject.toml` owns the shared Python dev dependencies and configurations for pytest, Ruff, ty, basedpyright, and pyrefly. Do not duplicate these in workspace members. All Python source, tests, and the analysis workbench are checked from the root against the same environment and Python version.

Use `make python-check` for all Python gates, or `make python-lint`, `make python-typecheck`, and `make python-test` for focused checks. `make check` and CI invoke these same targets once. Python-only packages are managed by uv; they do not need npm task wrappers.

## Public types and validation

Preserve application types with generics in action, snapshot, and transport contracts. Use `unknown` where input is actually unvalidated, then narrow it at the receiving boundary. Avoid generic parameters that only disguise unchecked assertions. Custom actions and schema description fields must stay open; do not require index signatures on domain interfaces or introduce schema generation. Zod 4 is available for runtime validation.

The vendored anti-slop sources remain unchanged. Local rule choices live in `tools/oxlint/anti-slop/preset.ts`; follow the documented preset rather than adding per-line exceptions. Knip checks dependencies and exports across the shared workspace.

## Change and validation discipline

Read the package's implementation and consumers before changing a contract. Update documentation, examples, fixtures, and tests in the same change. Search for stale imports and paths after relocation. Keep package manifests, TypeScript references, and both lockfiles aligned.

Test observable behavior through exported APIs and browser interactions. For visualization changes, run the affected Playwright cases and inspect browser output. For packaging changes, build from the workspace root and check the packaged output. Keep external model calls out of default tests.

Edit gallery route generation in `examples/gallery/scripts/sync-generated.mjs`, not its generated HTML or copied assets. Keep generated output, browser reports, local credentials, and evaluation runs out of version control. Do not run dependency upgrades, publish artifacts, or contact external model endpoints unless the task requests it.

CI runs the same checks and tests. Docker publishing is restricted to the main branch or manual dispatch. See `development_docs/contributing.md` for local commands and `development_docs/architecture.md` for runtime contracts.
