# Install

Every app installs `@ethivia/vacp-sdk` with [Zod](https://zod.dev), the schema library that declares an action's parameters:

```bash
pnpm add @ethivia/vacp-sdk zod
```

Import actions, providers, the runtime, the page bridge, and provenance from `@ethivia/vacp-sdk`, and the rest from its subpaths: `/data`, `/presence`, `/agent`, and `/inspector`. [What is VACP?](../what-is-vacp/#packages) lists what each entry holds.

The commands on this page use [pnpm](https://pnpm.io). `npm install` and `yarn add` take the same package names.

## Add an integration

Each integration is named after the library it connects. Install it together with that library:

| Your app uses                                                        | Install                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Vega-Lite](../vega-lite/) charts                                    | `pnpm add @ethivia/vacp-vega vega vega-lite vega-embed`                                                                         |
| [Mosaic vgplot](../vgplot/) dashboards                               | `pnpm add @ethivia/vacp-vgplot @uwdata/vgplot @uwdata/mosaic-core @uwdata/mosaic-inputs @uwdata/mosaic-plot @uwdata/mosaic-sql` |
| [DuckDB-Wasm](https://duckdb.org/docs/api/wasm/overview) in the page | `pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0`                                                                      |
| An [AI SDK agent](../agents/#run-an-agent-in-the-page) in the page   | `pnpm add @ethivia/vacp-ai ai`                                                                                                  |
| The [presence](../presence/) overlay in React                        | `pnpm add @ethivia/vacp-overlay react react-dom`                                                                                |
| [PostHog](https://posthog.com) telemetry                             | `pnpm add @ethivia/vacp-posthog posthog-js`                                                                                     |

`@ethivia/vacp-sdk/data` runs SQL over any DuckDB client. Add `@ethivia/vacp-duckdb` only when the page runs DuckDB-Wasm itself.

## Peer dependencies

Integrations declare `@ethivia/vacp-sdk` and their library as [peer dependencies](https://docs.npmjs.com/cli/configuring-npm/package-json#peerdependencies). Your app installs the library and picks its version, and VACP uses your app's copy. The providers read your app's own Vega views and Mosaic clients, so they need your app's copy of those libraries.

| Peer                                                                                        | Range              | Declared by                                            |
| ------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `@ethivia/vacp-sdk`                                                                         | `^0.1.0`           | every integration                                      |
| `zod`                                                                                       | `^4.6.7`           | `vacp-sdk`, `vacp-ai`                                  |
| `vega`, `vega-lite`                                                                         | `^6.4.0`, `^6.5.0` | `vacp-vega`                                            |
| `@uwdata/mosaic-core`, `@uwdata/mosaic-inputs`, `@uwdata/mosaic-plot`, `@uwdata/mosaic-sql` | `>=0.35.0`         | `vacp-vgplot`                                          |
| `@duckdb/duckdb-wasm`                                                                       | `>=1.32.0`         | `vacp-duckdb`                                          |
| `ai`                                                                                        | `^7.0.141`         | `vacp-ai`                                              |
| `react`, `react-dom`                                                                        | `^19.3.1`          | `vacp-overlay`                                         |
| `@types/react`, optional                                                                    | `^19.3.0`          | `vacp-overlay`, for TypeScript apps                    |
| `streamdown`, optional                                                                      | `^2.7.0`           | `vacp-overlay`, for `@ethivia/vacp-overlay/streamdown` |
| `posthog-js`                                                                                | `^1.438.10`        | `vacp-posthog`                                         |

Each range starts at the release VACP's tests run against. Mosaic is still at 0.x, so the `@uwdata/mosaic-*` range starts at 0.35 and accepts every later release.

`@duckdb/duckdb-wasm` is pinned in the commands above because its `latest` tag on npm is a prerelease. Mosaic also depends on DuckDB-Wasm, so a Mosaic app adds [an override](../vgplot/#query-dashboard-data-with-sql) to load one engine.

pnpm and npm install missing required peers on their own. Name the peers in your own `pnpm add` anyway, so `package.json` records the versions you chose. An optional peer installs only when you add it, for example `pnpm add streamdown` for Markdown in presence bubbles.

## Versions

Every `@ethivia/vacp-*` package shares one version number. Upgrade them together, so the package manager resolves one copy of `@ethivia/vacp-sdk`.

The packages are ES modules with TypeScript declarations under the Apache-2.0 license. They resolve under `"moduleResolution": "bundler"` and `"nodenext"`.

## Python

The `vacp` Python package runs the MCP server that connects external agents to a page. [Connect an agent](../agents/#connect-an-mcp-client) runs it with [uv](https://docs.astral.sh/uv/), the Python package manager, and lists its options. To build Python providers, add it to a project with `uv add vacp`, as the [Python reference](../api/python) describes.
