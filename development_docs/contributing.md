# Contributing

Install [pnpm](https://pnpm.io/installation) 11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/), then install the workspace and start the gallery:

```bash
pnpm install
pnpm dev
```

`package.json` pins pnpm and Node.js through `devEngines`. Any pnpm from 11 on switches to the pinned release, and pnpm downloads the declared Node.js for every script, so contributors and CI run the same versions. `pyproject.toml` sets the minimum uv release in `[tool.uv] required-version`.

`pnpm dev` serves the gallery at `https://examples.vacp.localhost`. Every workflow is a script in the root `package.json`. `uv run` installs the Python workspace on first use.

## Local URLs

[Portless](https://github.com/vercel-labs/portless) is a local proxy that gives each app a stable HTTPS name and assigns its port. Each app declares its name in the `portless` field of its `package.json`.

| Surface              | Command                                                        | URL                                               |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Gallery              | `pnpm dev`                                                     | `https://examples.vacp.localhost`                 |
| Documentation        | `pnpm dev:docs`                                                | `https://docs.vacp.localhost`                     |
| Vega-Lite            | `pnpm --filter @ethivia/vacp-example-vega-lite-gallery dev`    | `https://vega-lite.examples.vacp.localhost`       |
| vgplot               | `pnpm --filter @ethivia/vacp-example-vgplot-gallery dev`       | `https://vgplot.examples.vacp.localhost`          |
| React dashboard      | `pnpm --filter @ethivia/vacp-example-react-dashboard dev`      | `https://react-dashboard.examples.vacp.localhost` |
| Parallel coordinates | `pnpm --filter @ethivia/vacp-example-cars-parallel-coords dev` | `https://cars-parcoords.examples.vacp.localhost`  |

`pnpm dev:all` starts the documentation, the gallery, and every standalone example. The proxy listens on port 443 by default, and its first run asks to trust a local certificate authority. Linked git worktrees get a branch prefix in their names. See the [Portless HTTPS setup](https://github.com/vercel-labs/portless#http2--https) for other ports and certificates.

To serve one app on a fixed port without the proxy, run `PORTLESS=0 pnpm --filter <package> dev --port <port>`. Playwright starts its servers this way.

## Checks

```bash
pnpm fix
pnpm ready
pnpm e2e:install
pnpm e2e
```

`pnpm ready` runs `pnpm check`, `pnpm test`, and `pnpm test:packages`. `pnpm fix` applies lint fixes and formats TypeScript and Python. `pnpm check` runs these gates:

- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) formatting and [Oxlint](https://oxc.rs/docs/guide/usage/linter) linting through `vp check`, with the anti-slop preset.
- [Ruff](https://docs.astral.sh/ruff/) linting and formatting, and the [ty](https://docs.astral.sh/ty/), [basedpyright](https://docs.basedpyright.com), and [pyrefly](https://pyrefly.org) type checkers over the Python workspace.
- TypeScript over every package, app, and example.
- [Knip](https://knip.dev), which finds unused files, exports, and dependencies.

Tests and type checks read workspace packages from source through the `vacp-source` export condition, so none of them needs a library build. `pnpm test` runs every workspace `test` script, the vendored lint rule tests among them, and then pytest. `pnpm e2e` builds the examples and the documentation and runs Playwright against them. See [testing](testing.md) for the suite layout.

For one package or suite:

```bash
pnpm --filter @ethivia/vacp-sdk test
pnpm --filter @ethivia/vacp-e2e exec playwright test tests/smoke
uv run --locked pytest packages/python/tests
```

### Agent evals

`apps/evals` runs agents against the examples and grades the resulting page state, rendered text, and replies, with tokens, latency, and reads per run. `pnpm test` runs its unit tests only, because eval runs call models. Follow [apps/evals/README.md](../apps/evals/README.md) to run them.

## Source imports and library output

Use extensionless relative imports and re-exports in TypeScript source, and package names across workspace boundaries:

```ts
import type { InspectionObservation } from './types';
import { parseVacpNarration } from '@ethivia/vacp-sdk/agent';
```

Each library builds with `vp pack`, which inherits the `pack` block in the root `vite.config.ts`. [Vite+ Pack](https://viteplus.dev/guide/pack) keeps the source module structure in its unbundled mode and emits ESM and declarations that load in native Node. `tsconfig.base.json` configures TypeScript for type checking only, with bundler resolution.

`pnpm test:packages` packs every library, installs the tarballs into a consumer outside the workspace with each declared peer at its tested version, imports every public entry in native Node with type stripping disabled, and type-checks the same entries from a strict NodeNext consumer. A dependency the workspace hoists but a manifest omits fails there. Declare every type a public declaration references in that package's `dependencies`, or as a peer when the application owns the library.

### Lint policy

Repository scripts are TypeScript files in the private `scripts` workspace package. Root `package.json` scripts run them with `node`. Lint-rule and StyleX tooling lives in the `tools` workspace package. Gallery generation belongs to `examples/gallery/scripts` and runs through that app's `generate` command. `pnpm check` covers all of them with the shared formatting, standard lint, anti-slop, and TypeScript rules.

The anti-slop rules are vendored unchanged under `tools/oxlint/anti-slop`. `tools/oxlint/anti-slop/preset.ts` selects which rules apply. It turns off bans on `unknown` at boundaries, runtime narrowing, open dictionaries, ordinary assertions, conditional spreads, and naming and spacing conventions. It keeps the rules against chained assertions, widening followed by assertion, reflection shortcuts, module mocking, repeated array passes, and accumulator copying. Change the preset rather than adding per-line exceptions.

The table in `vite.config.ts` lists which `@ethivia/vacp-sdk` entries each integration package may import. Inside the core, `packages/sdk/test/layers.test.ts` keeps every layer under `src/` pointing inward. Update the table or the test together with the import that needs it.

## Python QA

The root `pyproject.toml` holds the shared development tools and the configuration for pytest, Ruff, ty, basedpyright, and pyrefly. Member manifests hold package metadata and runtime dependencies.

```bash
pnpm py:check                   # Ruff, ty, basedpyright, and pyrefly
uv run --locked pytest          # the test suite
pnpm py:package                 # the built wheel and source distribution
UV_PYTHON=3.10 pnpm py:package  # the same, on another supported Python
```

The checks cover Python source and tests under `packages`, `apps`, `examples`, and `tools`. Ruff and the type checkers target Python 3.10. `.python-version` selects the development interpreter, and `UV_PYTHON` overrides it with `3.10`, `3.11`, `3.12`, `3.13`, or `3.14`.

`pnpm py:package` builds a source distribution and a wheel from that source distribution, and validates their metadata and README rendering with [Twine](https://twine.readthedocs.io/), the Python package upload and validation tool. It then installs each distribution in isolated environments, verifies the base API and CLI, and runs the full test suite with the `server` and `http` extras. CI runs this check on all five supported Python versions.

### Python publication

The Python package metadata, version, and Apache-2.0 license live in `packages/python`. Build and check the release from the repository root:

```bash
pnpm py:package
```

Upload the two versioned files from `dist/python` with [`uv publish`](https://docs.astral.sh/uv/guides/publish/#publishing-your-package), which sends Python distributions to the Python Package Index (PyPI):

```bash
uv publish dist/python/vacp-0.1.1-py3-none-any.whl dist/python/vacp-0.1.1.tar.gz
```

Use the version declared in `packages/python/pyproject.toml`. Publishing requires a PyPI account with permission to release `vacp` and credentials configured for uv.

## npm packages

Each folder in `packages/`, except `python`, is the npm package `@ethivia/vacp-<folder>`. Every package carries the same version and the Apache-2.0 license from the root `LICENSE`, which `pnpm pack` adds to each tarball.

`@ethivia/vacp-sdk` is the core every application installs. Its entries in `src/entries` list each public name explicitly: the root, `/data`, `/presence`, `/agent`, and `/inspector`. A separate integration package exists only to keep a peer library off the core install, and it takes `@ethivia/vacp-sdk` as a peer so an application loads one copy of the core.

A public name carries the `Vacp` prefix when its noun is generic, such as action, provider, runtime, ref, node, graph, actor, bridge, or tool: `createVacpRuntime`, `VacpRef`, `vacpHumanActor`. A name built on a distinctive noun leaves the prefix off. Those nouns are provenance, presence, inspector, and the connected library: `ProvenanceRecord`, `createPresenceOverlay`, `createInspectorSession`, `createVegaLiteProvider`.

- Internal dependencies use `workspace:^`, which packing rewrites to a caret range of the shared version.
- A library the application also imports or passes in, such as Zod, Vega, Mosaic, React, the AI SDK, DuckDB-Wasm, or PostHog, is a `peerDependency` with the same library as a `catalog:` dev dependency. The peer range starts at the release the workspace tests run against, the version `pnpm-lock.yaml` resolves for that catalog entry. A stable library accepts the rest of that major, such as `^6.4.0` for Vega. A 0.x library, or one whose npm `latest` tag is a prerelease, accepts every later release, such as `>=0.35.0` for Mosaic and `>=1.32.0` for DuckDB-Wasm. Mark a peer optional in `peerDependenciesMeta` when only one entry or only TypeScript consumers need it.
- A library only the package uses stays in `dependencies`.
- `.pnpmfile.mjs` removes the `vacp-source` export condition while packing, so published manifests point only at `dist`.

`pnpm pack:local` builds every library and packs it into `dist/npm`. Each tarball holds `package.json`, `README.md`, the root `LICENSE`, and `dist`. `pnpm test:packages` runs `pnpm pack:local`, fails on any other file in a tarball, and installs and imports those tarballs. `pnpm pack:local <app-dir>` also points the application's pnpm overrides at the tarballs, so the documented `pnpm add` lines install local builds. [Install](../docs/install/index.md) is the consumer-facing list of packages and peers. Keep it in step with the manifests.

## Dependency updates

```bash
pnpm self-update
pnpm -r update
uv lock --upgrade
pnpm ready
pnpm e2e
```

pnpm installs releases at least 18 hours old (`minimumReleaseAge` in `pnpm-workspace.yaml`), and uv applies the same window through `exclude-newer` in `pyproject.toml`. An update that names a newer release fails until the release is old enough.

Shared versions live in the `catalog` of `pnpm-workspace.yaml`. When a catalog update moves a peer to a new release, start that peer range at the new release in the declaring manifests and in [Install](../docs/install/index.md). `patchedDependencies` pins a patch to one exact version. When you update a patched package, rebase its patch with `pnpm patch <name>@<version>` and `pnpm patch-commit`.

GitHub Actions are pinned to commit SHAs with their release tag in a comment. Update the SHA and the tag together.

Commit `pnpm-lock.yaml` and `uv.lock` with the manifest changes.

## CI and deployment

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. Each job calls the root scripts:

| Job                  | Runs                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Formatting           | `vp fmt --check`                                                                           |
| Lint and types       | `pnpm check`                                                                               |
| Unit tests           | `pnpm test` and `pnpm test:packages`                                                       |
| Python distributions | `pnpm py:package` on Python 3.10 through 3.14                                              |
| Build                | `pnpm build`, then uploads the library, gallery, and docs builds                           |
| Browser suite        | `pnpm --filter @ethivia/vacp-e2e test:e2e --shard=N/4` in four shards against those builds |
| Browser report       | Merges the shards' blob reports into one HTML `playwright-report` artifact                 |
| CI gate              | Fails unless every job above succeeded, so branch protection can require this check alone  |

`.github/actions/setup` installs pnpm and Node.js from `devEngines` through [`pnpm/setup`](https://github.com/pnpm/setup), and, for jobs that need Python, uv from `required-version` through [`setup-uv`](https://github.com/astral-sh/setup-uv). A failed shard uploads its traces and screenshots as `test-results-N`. To reproduce one shard locally, run `pnpm build`, then `pnpm --filter @ethivia/vacp-e2e test:e2e --shard=2/4`.

The image workflow runs after successful CI on `main`, or by manual dispatch on `main`. It builds the documentation and gallery images from `infra/*.Dockerfile` and pushes them to the configured [Harbor](https://goharbor.io) container registry, tagged with the tested commit SHA and `latest`. The images start from `ghcr.io/pnpm/pnpm`, and `pnpm install` provisions Node.js from `devEngines.runtime`. Registry credentials are GitHub Actions secrets.

`.github/workflows/pages.yml` builds the documentation site on pull requests that change it and deploys every `main` commit to [GitHub Pages](https://docs.github.com/en/pages). The workflow passes the site base to the VitePress config as `BASE_PATH`: the Pages base path from `actions/configure-pages` on `main`, and the repository path, `/VACP`, on pull requests. The deploy job skips a commit that is no longer the tip of `main`.

## Documentation

`docs/` holds the Markdown pages of the documentation site. `apps/docs` is the [VitePress](https://vitepress.dev) app that builds them, with its configuration and theme in `.vitepress/` and static assets in `public/`. Run `pnpm dev:docs` to preview it and `pnpm --filter @ethivia/vacp-docs build` to build it. `development_docs/` holds architecture, contribution, and test guides for people working on this repository.

The build also writes `llms.txt`, `llms-full.txt`, and a Markdown view of each guide and reference page to `apps/docs/.vitepress/dist` with [`vitepress-plugin-llms`](https://github.com/okineadev/vitepress-plugin-llms). The build then points each relative and root-relative link in them at the Markdown view, page, or file it names under the site base, and fails on a link that names none of them. Put images in `apps/docs/public` and link them from the site root, such as `/images/VACP_Teaser.svg`.

The views drop HTML and Vue components. Describe what a component such as `<ArchitectureDiagram />` shows in the page's prose, or in `<llm-only>` tags separated from the text by blank lines.
