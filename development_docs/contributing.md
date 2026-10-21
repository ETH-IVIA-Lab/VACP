# Contributing

Install [pnpm](https://pnpm.io/installation) 11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/), then set up and build the workspace:

```bash
make setup build
make dev
```

`package.json` pins pnpm and Node.js through `devEngines`. Any pnpm from 11 on switches to the pinned release, and pnpm downloads the declared Node.js for every script, so contributors and CI run the same versions. `pyproject.toml` sets the minimum uv release in `[tool.uv] required-version`.

`make dev` serves the gallery at `https://examples.vacp.localhost`. Run `make help` for every target.

## Local URLs

[Portless](https://github.com/vercel-labs/portless) is a local proxy that gives each app a stable HTTPS name and assigns its port. Each app declares its name in the `portless` field of its `package.json`.

| Surface              | Command                                                        | URL                                               |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Gallery              | `make dev`                                                     | `https://examples.vacp.localhost`                 |
| Documentation        | `make docs-serve`                                              | `https://docs.vacp.localhost`                     |
| Vega-Lite            | `pnpm --filter @ethivia/vacp-example-vega-lite-gallery dev`    | `https://vega-lite.examples.vacp.localhost`       |
| vgplot               | `pnpm --filter @ethivia/vacp-example-vgplot-gallery dev`       | `https://vgplot.examples.vacp.localhost`          |
| React dashboard      | `pnpm --filter @ethivia/vacp-example-react-dashboard dev`      | `https://react-dashboard.examples.vacp.localhost` |
| Parallel coordinates | `pnpm --filter @ethivia/vacp-example-cars-parallel-coords dev` | `https://cars-parcoords.examples.vacp.localhost`  |

`make dev-all` starts the documentation, the gallery, and every standalone example. `make dev-status` lists active routes. The proxy listens on port 443 by default, and its first run asks to trust a local certificate authority. Linked git worktrees get a branch prefix in their names. See the [Portless HTTPS setup](https://github.com/vercel-labs/portless#http2--https) for other ports and certificates.

To serve one app on a fixed port without the proxy, run `PORTLESS=0 pnpm --filter <package> dev --port <port>`. Playwright starts its servers this way.

## Checks

```bash
make format check
make browser-install e2e
```

`make check` runs these gates:

- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) formatting and [Oxlint](https://oxc.rs/docs/guide/usage/linter) linting through `vp check`, with the anti-slop preset, over the source roots in `SOURCE_PATHS`.
- [Ruff](https://docs.astral.sh/ruff/) linting and formatting, and the [ty](https://docs.astral.sh/ty/), [basedpyright](https://docs.basedpyright.com), and [pyrefly](https://pyrefly.org) type checkers over the Python workspace.
- TypeScript over every package, app, and example.
- [Knip](https://knip.dev), which finds unused files, exports, and dependencies.
- The vendored lint rule tests and every unit test suite.

`make e2e` builds the examples and the documentation and runs Playwright against them. See [testing](testing.md) for the suite layout.

For one package or suite:

```bash
pnpm --filter @ethivia/vacp-runtime test
pnpm --filter @ethivia/vacp-e2e exec playwright test tests/smoke
uv run --all-packages --all-groups --locked pytest packages/python/tests
```

### Agent evals

`apps/evals` runs agents against the examples and grades the resulting page state, rendered text, and replies, with tokens, latency, and reads per run. `make check` runs its unit tests only, because eval runs call models. Build the libraries with `make build-libs`, then follow [apps/evals/README.md](../apps/evals/README.md).

## Source imports and library output

Use extensionless relative imports and re-exports in TypeScript source, and package names across workspace boundaries:

```ts
import type { InspectionObservation } from './types';
import { parseVacpNarration } from '@ethivia/vacp-protocol';
```

Each library builds with `vp pack`, which inherits the `pack` block in the root `vite.config.ts`. [Vite+ Pack](https://viteplus.dev/guide/pack) keeps the source module structure in its unbundled mode and emits ESM and declarations that load in native Node. `tsconfig.base.json` configures TypeScript for type checking only, with bundler resolution.

`make test-package-imports` imports every public entry of every built package in native Node with type stripping disabled, and type-checks the same entries from a strict NodeNext consumer. Declare every type a public declaration references in that package's `dependencies`.

### Lint policy

Repository commands live in the private `scripts` workspace. Run them with `pnpm --filter @ethivia/vacp-scripts <command>`. Its `tsconfig.json` covers every script. Gallery generation belongs to `examples/gallery/scripts` and runs through that app's `generate` command. `make lint` checks these scripts with the shared formatting, standard lint, anti-slop, and TypeScript rules.

The anti-slop rules are vendored unchanged under `tools/oxlint/anti-slop`. `tools/oxlint/anti-slop/preset.ts` selects which rules apply. It turns off bans on `unknown` at boundaries, runtime narrowing, open dictionaries, ordinary assertions, conditional spreads, and naming and spacing conventions. It keeps the rules against chained assertions, widening followed by assertion, reflection shortcuts, module mocking, repeated array passes, and accumulator copying. Change the preset rather than adding per-line exceptions.

The dependency table in `vite.config.ts` lets each package import only the workspace packages that sit inward of it. Add a workspace dependency there and in the package manifest together.

## Python QA

The root `pyproject.toml` holds the shared development tools and the configuration for pytest, Ruff, ty, basedpyright, and pyrefly. Member manifests hold package metadata and runtime dependencies.

```bash
make python-check       # every Python gate
make python-format      # format Python source
make python-lint        # lint and format check
make python-typecheck   # ty, basedpyright, and pyrefly
make python-test        # the combined test suite
make python-test-package PYTHON=3.10 # installed wheel and source distribution
```

The checks cover Python source and tests under `packages`, `apps`, `examples`, and `tools`. Ruff and the type checkers target Python 3.10. Make targets use Python 3.12 and the root virtual environment by default. Pass `PYTHON=3.10`, `3.11`, `3.12`, `3.13`, or `3.14` to select another supported interpreter.

`make package` builds a source distribution and a wheel from that source distribution, then validates their metadata and README rendering with [Twine](https://twine.readthedocs.io/), the Python package upload and validation tool. `make python-test-package` installs each distribution in isolated environments, verifies the base API and CLI, and runs the full test suite with the `server` and `http` extras. CI runs this check on all five supported Python versions.

### Python publication

The Python package metadata, version, and Apache-2.0 license live in `packages/python`. Build and check the release from the repository root:

```bash
make package
make python-test-package
```

Upload the two versioned files from `dist/python` with [`uv publish`](https://docs.astral.sh/uv/guides/publish/#publishing-your-package), which sends Python distributions to the Python Package Index (PyPI):

```bash
uv publish dist/python/vacp-0.1.1-py3-none-any.whl dist/python/vacp-0.1.1.tar.gz
```

Use the version declared in `packages/python/pyproject.toml`. Publishing requires a PyPI account with permission to release `vacp` and credentials configured for uv.

## Dependency updates

```bash
pnpm self-update
pnpm -r update
uv lock --upgrade
make setup check e2e
```

pnpm installs releases at least 18 hours old (`minimumReleaseAge` in `pnpm-workspace.yaml`), and uv applies the same window through `exclude-newer` in `pyproject.toml`. An update that names a newer release fails until the release is old enough.

Shared versions live in the `catalog` of `pnpm-workspace.yaml`. Mosaic and Vega packages sit there because the vgplot adapter identifies Mosaic classes by identity and the Vega-Lite adapter reads Vega views, so an application and the adapters must load one copy. `patchedDependencies` pins a patch to one exact version. When you update a patched package, rebase its patch with `pnpm patch <name>@<version>` and `pnpm patch-commit`.

GitHub Actions are pinned to commit SHAs with their release tag in a comment. Update the SHA and the tag together.

Commit `pnpm-lock.yaml` and `uv.lock` with the manifest changes.

## CI and deployment

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. Each job calls Makefile targets:

| Job                  | Runs                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Lint and types       | `make lint python-typecheck knip test-tools`                                              |
| Unit tests           | `make test`                                                                               |
| Python distributions | `make python-test-package` on Python 3.10 through 3.14                                    |
| Build                | `make build package`, then uploads the library, gallery, and docs builds                  |
| Browser suite        | `make browser-test PLAYWRIGHT_ARGS=--shard=N/4` in four shards against those builds       |
| Browser report       | Merges the shards' blob reports into one HTML `playwright-report` artifact                |
| CI gate              | Fails unless every job above succeeded, so branch protection can require this check alone |

`.github/actions/setup` installs pnpm and Node.js from `devEngines` through [`pnpm/setup`](https://github.com/pnpm/setup), and, for jobs that need Python, uv from `required-version` through [`setup-uv`](https://github.com/astral-sh/setup-uv). A failed shard uploads its traces and screenshots as `test-results-N`. To reproduce one shard locally, run `make build browser-test PLAYWRIGHT_ARGS=--shard=2/4`.

The image workflow runs after successful CI on `main`, or by manual dispatch on `main`. It builds the documentation and gallery images from `infra/*.Dockerfile` and pushes them to the configured [Harbor](https://goharbor.io) container registry, tagged with the tested commit SHA and `latest`. The images start from `ghcr.io/pnpm/pnpm`, and `pnpm install` provisions Node.js from `devEngines.runtime`. Registry credentials are GitHub Actions secrets.

`.github/workflows/pages.yml` builds the documentation site on pull requests that change it and deploys every `main` commit to [GitHub Pages](https://docs.github.com/en/pages). The workflow passes the site base to the VitePress config as `BASE_PATH`: the Pages base path from `actions/configure-pages` on `main`, and the repository path, `/VACP`, on pull requests. The deploy job skips a commit that is no longer the tip of `main`.

## Documentation

`docs/` holds the Markdown pages of the documentation site. `apps/docs` is the [VitePress](https://vitepress.dev) app that builds them, with its configuration and theme in `.vitepress/` and static assets in `public/`. Run `make docs-serve` to preview it and `make docs` to build it. `development_docs/` holds architecture, contribution, and test guides for people working on this repository.

`make docs` also writes `llms.txt`, `llms-full.txt`, and a Markdown view of each guide and reference page to `apps/docs/.vitepress/dist` with [`vitepress-plugin-llms`](https://github.com/okineadev/vitepress-plugin-llms). The build then points each relative and root-relative link in them at the Markdown view, page, or file it names under the site base, and fails on a link that names none of them. Put images in `apps/docs/public` and link them from the site root, such as `/images/VACP_Teaser.svg`.

The views drop HTML and Vue components. Describe what a component such as `<ArchitectureDiagram />` shows in the page's prose, or in `<llm-only>` tags separated from the text by blank lines.
