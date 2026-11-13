# Working on VACP

VACP composes analytical sources, state, freshness, and semantic actions through transport-neutral providers and an in-page bridge. Preserve the shared human/agent interaction model and its history semantics.

## Workspace

- `packages/sdk`: the core every application installs. Its layers live in `src` (`protocol`, `runtime`, `browser`, `actions`, `data`, `bridge`, `webmcp`, `provenance`, `presence`, `inspector`). `src/entries` lists the public names of the root, `/data`, `/presence`, `/agent`, and `/inspector`.
- `packages/vega`, `packages/vgplot`: visualization providers.
- `packages/duckdb`: the DuckDB-Wasm client.
- `packages/ai`, `packages/python`: model orchestration and MCP transport.
- `packages/overlay`: optional React cursor overlay styled with StyleX.
- `packages/posthog`: delivery of provenance records to PostHog.
- `skills/vacp`: the agent skill that teaches coding agents to add VACP to an application.
- `vite.shared.ts`: `defineExampleConfig`, the shared Vite configuration for examples.
- `examples/shared`: example-only runtime composition, presence and replay, gallery shell, and options.
- `examples/gallery`: gallery composition and generated routes.
- `examples/athlete-explorer`, `examples/cars-parallel-coords`, `examples/react-dashboard`, `examples/vega-lite-gallery`, `examples/vgplot-gallery`: runnable examples.
- `examples/custom-integration`: the custom-provider source that the docs include and the SDK tests run.
- `apps/e2e`: Playwright tests through the browser and public bridge.
- `apps/evals`: agent evals that run conditions (agent loops, including AI SDK harnesses) and models on the examples through VACP and grade page state, replies, tokens, and latency. Eval runs call models, so `pnpm test` runs only its unit tests.
- `apps/docs`: the VitePress app: `.vitepress` configuration and theme, and static assets in `public/`.
- `docs/`: the Markdown pages of the documentation site: guides and API reference.
- `development_docs/`: architecture, contributing, and testing guides.

Keep `packages/` flat. Each folder except `python` is the npm package `@ethivia/vacp-<folder>`. `sdk` is the core, and every other folder is named for the library it connects. `packages/python` is the PyPI package `vacp`. A separate package exists only to keep a peer library off the core install, and it takes `@ethivia/vacp-sdk` as a peer. New capabilities without a peer library join a layer of the core. Libraries share one version and the root Apache-2.0 `LICENSE`. Internal dependencies use `workspace:^`. Libraries the application owns, such as Zod, Vega, Mosaic, React, the AI SDK, DuckDB-Wasm, and PostHog, are peer dependencies with a `catalog:` dev dependency. `development_docs/contributing.md` states the range policy.

## Dependency rules

Dependencies point toward the protocol. Protocol and runtime must not read window, document, URL configuration, or browser storage. Protocol must remain independent of providers, transports, UI frameworks, and applications. Runtime owns snapshot, action, and history behavior against its snapshot and action contracts. Providers translate their visualization's state and actions into those contracts.

Applications compose providers, transports, and optional UI. Pass exposure and SQL policy explicitly. Libraries must not read URL flags, environment variables, or browser storage to choose capabilities. Example context profiles belong under `examples/`. Connect custom inspection surfaces through an explicit `InspectorClient`. Keep request state and optional history in the `inspector` layer. Presentation, selection, and navigation belong to the consuming surface. Inspection must not mutate the source. Restoration is a separate, explicitly supplied capability. Keep UI dependencies out of `@ethivia/vacp-sdk`. Libraries must not import applications or another package's private source paths. Declare workspace dependencies in the importing package and use its exported API. Inside the core, layers import inward only, and `packages/sdk/test/layers.test.ts` enforces it.

Add an integration as a focused provider implementing the source, projection, observation, and action ports. Compose sources by stable source ID and keep one owner for every node and action. Discovery adapters may infer mechanical facts. Analytical meaning belongs in library or application profiles. Runtime extensions use capability subscriptions and the runtime lifetime signal. Keep target-platform registration and metadata in their own transport layer. Keep provider-specific branches in the provider. Avoid compatibility aliases and parallel APIs when replacing a contract.

## Commands

Every workflow is a root `package.json` script. Run them from the repository root:

| Command                            | Does                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm install`                     | Installs the JavaScript workspace. `uv run` installs the Python workspace on first use. |
| `pnpm dev`                         | Serves the gallery at `https://examples.vacp.localhost`                                 |
| `pnpm dev:docs`                    | Serves the docs at `https://docs.vacp.localhost`                                        |
| `pnpm dev:all`                     | Serves the docs, the gallery, and every standalone `*.examples.vacp.localhost` app      |
| `pnpm check`                       | Formatting, lint rules, TypeScript types, unused code (knip), and the Python gates      |
| `pnpm fix`                         | Applies lint fixes and formats TypeScript and Python                                    |
| `pnpm test`                        | Every workspace `test` script, then pytest                                              |
| `pnpm test:packages`               | Packs the libraries and imports every export from a clean consumer                      |
| `pnpm build`                       | Builds the libraries, the examples, and the docs                                        |
| `pnpm e2e:install`, `pnpm e2e`     | Installs Chromium once, then builds and runs the Playwright suite                       |
| `pnpm py:check`, `pnpm py:package` | The Python gates alone, and the built wheel and sdist tested in isolation               |
| `pnpm ready`                       | `check`, `test`, and `test:packages`, the gates a change must pass                      |

Use `pnpm --filter <package-name> <script>` for focused work. Tests, type checks, and examples read workspace packages from source through the `vacp-source` export condition, so none of them needs a build first. Repository scripts are TypeScript files in the `scripts` workspace package that `node` runs directly. Lint-rule and StyleX tooling lives in the `tools` workspace package.

Names for local URLs live in each app's `package.json` under `portless`. Vite+ receives its port from Portless. VitePress reads `PORT` in its config. Preserve the `PORTLESS=0` bypass and explicit ports in the Playwright server helper. Vite+ owns JavaScript task orchestration, formatting, type-aware linting, type checking, and builds. Vite+ Pack emits library JavaScript and declarations.

## Python QA

The root `pyproject.toml` owns the shared Python dev dependencies and the configuration for pytest, Ruff, ty, basedpyright, and pyrefly. Do not duplicate these in workspace members. All Python source and tests are checked from the root against one environment. `.python-version` picks the development Python, and `UV_PYTHON` overrides it.

## TypeScript imports and builds

Use extensionless relative imports and re-exports in owned TypeScript source, including type imports: `./types` and `./Component`. Workspace dependencies use public package exports such as `@ethivia/vacp-sdk/data`. Keep actual asset filenames and vendored source conventions intact.

The root `vite.config.ts` owns library packaging policy. Each library runs `vp pack`, which inherits that configuration, preserves module structure with `unbundle`, and emits Node-compatible ESM and declarations. `tsconfig.base.json` owns no-emit type checking with bundler resolution. Vite+ orders package tasks using the pnpm workspace dependency graph. Do not add import-rewriting scripts, custom loaders, or source aliases for package consumers. Every library export lists a `vacp-source` condition first, and only `defineExampleConfig` enables it. `.pnpmfile.mjs` strips it while packing.

`@ethivia/vacp-overlay` components use StyleX and render into a shadow root. Its `vite.config.ts` adds `vacpPresenceSheet` from `vite.shared.ts` to `vp pack`, and `defineExampleConfig` adds the same plugin because examples compile the package source through the `vacp-source` export condition. Style components with `stylex.create`, and keep motion that runs every frame in the motion controllers.

`pnpm test:packages` installs the packed tarballs with their declared peers and exercises every JavaScript package export in native Node and a strict NodeNext TypeScript consumer using the built declarations. Keep this check working alongside browser builds when changing imports, exports, or compiler options. Public declaration dependencies belong in the declaring package's dependencies.

## Public types and validation

Prefix a public name with `Vacp` when its noun is generic, such as action, provider, runtime, ref, node, graph, actor, bridge, or tool. Leave the prefix off a name built on a distinctive noun: provenance, presence, inspector, or the connected library. `development_docs/contributing.md` gives examples.

Preserve application types with generics in action, snapshot, and transport contracts. Use `unknown` where input is actually unvalidated, then narrow it at the receiving boundary. Avoid generic parameters that only disguise unchecked assertions. Custom actions and schema description fields must stay open. Do not require index signatures on domain interfaces. SDK actions use `.params(zodSchema)` to derive input JSON Schema at definition time and infer parsed callback types. Keep Zod conversion in the `actions` layer. Protocol and runtime contracts remain schema-library agnostic. Do not add generated schema files or a schema build step.

The vendored anti-slop sources remain unchanged. Local rule choices live in `tools/oxlint/anti-slop/preset.ts`; follow the documented preset rather than adding per-line exceptions. Knip checks dependencies and exports across the shared workspace.

## Behavioral boundaries

- Providers describe the full catalog and current availability. Use explicit node prerequisites and host readiness reasons; do not infer prerequisites from containment or effects. Keep disclosure and execution guards in the shared protocol resolver. Agent reads disclose the current surface; inspection reads retain the catalog. Python and TypeScript availability semantics share conformance fixtures.

- Preparation validates every supplied input and resolves its native target before mutation. Retain normalized values and the target in a single-use execution closure. Recheck lifetime before applying effects. Runtime errors can still occur after preparation. Report partial effects honestly.
- Share one adapter-local binding inventory across discovery, state, execution, restoration, and optional presentation. Keep compiler names, native unit scopes, selection plumbing, and coordinate transforms inside the adapter. Consumers use refs. They do not decode paths to rediscover native objects.
- Observation must preserve native behavior, return values, promise identity, rendering, and ownership. Prefer host subscriptions. When instrumentation is necessary, one shared connection owns each resource and fans out to consumers. Detach only owned hooks, including on failed setup. Borrowing a visualization never grants permission to finalize it.
- Distinguish action completion, output freshness, and visual arrival. Claim current outputs only from a native revision or settlement witness. Missing freshness means unknown. Elapsed time does not establish settlement. Rendering errors must not trigger a second mutation through another route.
- The runtime owns live observations and recording. Each viewer owns historical selection. Restoration is an explicit action against live sources, with visible results and cancellation. Multiple viewers must remain independent.
- Passive observation ports grant no execution authority. Hosts supply optional pacing separately. Presentation waits are bounded, disposable, and cannot change a known action result. Pacing does not serialize otherwise concurrent actions.
- Agents narrate for the person, never for themselves. Every action call carries its step's own sentence as the execution's `narration`, and every transport offers one progress tool for an opening and a closing sentence, spoken through `runtime.narrate()`. The wording and its parser live once in the `protocol` layer. One request is one turn: an agent's first step opens it when no sentence did, and its steps and sentences keep it open. A sentence belongs to one step and is never repeated on the next. Transports show only what the model wrote. Words about a step start with the step: a viewer holds narration that arrives between an actor's steps until the next execution begins. Hosts grant pacing separately, and only executions shown by a presence viewer wait.
- Captured facts are immutable and shared. Clone once at capture, freeze, and extend consumer mirrors by revision instead of re-reading or re-copying whole histories. Presentation work follows native change witnesses and runs on the compositor where possible. Measure performance claims with `pnpm bench` before and after a change.
- Examples remain ordinary analytical applications with a thin VACP integration. Put automation, diagnostic controls, and recording drivers in test tooling or ignored local artifacts. Add packages for independent consumers or dependency boundaries, not to distribute one responsibility across more files.

See [architecture.md](development_docs/architecture.md) for these ownership contracts and [testing.md](development_docs/testing.md) for their verification boundaries.

## Change and validation discipline

Read the package's implementation and consumers before changing a contract. Update documentation, examples, fixtures, and tests in the same change. Search for stale imports and paths after relocation. Keep package manifests, TypeScript references, and both lockfiles aligned.

Test observable behavior through exported APIs and browser interactions. For visualization changes, run the affected Playwright cases and inspect browser output in a fresh session. Assert native rows, controls, marks, and geometry against independent renderer evidence; successful action envelopes and self-reported precision are insufficient. Keep recordings paired with the exact scenario results and promote artifacts only after their assertions succeed. For packaging changes, build from the workspace root and check the packaged output. Keep external model calls out of default tests.

Edit gallery route generation in `examples/gallery/scripts/sync-generated.ts`, not its generated HTML or copied assets. Keep generated output, browser reports, and local credentials out of version control. Do not run dependency upgrades, publish artifacts, or contact external model endpoints unless the task requests it.

CI runs the same checks and tests. Docker publishing is restricted to the main branch or manual dispatch. See `development_docs/contributing.md` for local commands and `development_docs/architecture.md` for runtime contracts.
