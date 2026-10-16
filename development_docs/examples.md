# Examples

The examples are ordinary analytical applications with a thin VACP integration. Each lives in `examples/<name>`, exports one `mount(target)`, and runs standalone or inside the gallery.

```ts
export async function mount(target: HTMLElement): Promise<() => void | Promise<void>>;
```

`mount` renders the application, installs its runtime, and resolves to the function that unmounts it. A failed mount releases what it created before it rejects.

## Shared composition

`@vacp/example-shared` holds what every example composes the same way:

| Export                                                                    | Owns                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `installExampleRuntime({ sources, root, sessionKey, analytics, signal })` | The runtime and bridge, presence with replay, pacing, WebMCP, and analytics. Aborting `signal` releases all of them |
| `mountSpecGallery(target, { entries, render, describe? })`                | The spec picker, hash sync, and per-entry lifetime of the Vega-Lite and vgplot galleries                            |
| `exampleOptions` (`@vacp/example-shared/config`)                          | Exposure, SQL, WebMCP, and pacing settings                                                                          |
| `exampleDuckDbBundles`                                                    | The DuckDB-Wasm engine files the examples serve                                                                     |
| `renderExampleError`, `escapeHtml`                                        | Error display and HTML escaping                                                                                     |

Each source passed to `installExampleRuntime` is `{ provider, presentation }`, so presence attaches every provider. A trusted pointer, key, or input event on `root` interrupts a pending replay restoration.

### Options

`exampleOptions` merges `globalThis.__vacpExampleOptions` over the defaults, read once when the module loads:

| Option              | Default | Effect                                               |
| ------------------- | ------- | ---------------------------------------------------- |
| `exposeBridge`      | `true`  | Publish `window.__vacp`                              |
| `injectDomSnapshot` | `true`  | Write DOM snapshot scripts                           |
| `enableSql`         | `true`  | Register `vacp.data_sql`                             |
| `webmcp`            | `true`  | Register WebMCP tools when the browser supports them |
| `paceAgentSteps`    | `true`  | Pace agent steps for a person to follow              |
| `agentStepPauseMs`  | 1200    | The pause after each agent step                      |

Tests and evals set `__vacpExampleOptions` in an init script before the page loads. Applications built on VACP choose these policies in their own code.

## The examples

| Example                | Sources                                                           | Custom operations                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `athlete-explorer`     | Vega-Lite physique chart, vgplot age histogram, cohort controls   | `cohort.set_sports`, `cohort.set_sex`                                                                                                                         |
| `vgplot-gallery`       | One vgplot specification per entry, from `src/specs/*.yaml`       |                                                                                                                                                               |
| `vega-lite-gallery`    | One Vega-Lite specification per entry, from `src/specs/*.vl.json` |                                                                                                                                                               |
| `react-dashboard`      | Recharts views and a TanStack table over Iris and Motor Trend     | `dashboard.set_dataset`, `set_encoding`, `set_selected_ids`, `toggle_selected_id`, `set_brush_2d`, `clear_brush_2d`, `select_by_quantiles`, `clear_selection` |
| `cars-parallel-coords` | D3 parallel coordinates over 392 cars                             | `parallel_coords.set_brush_ranges`, `reset_brushes`, `set_dimension_order`, `reset_dimension_order`, `set_hover`                                              |
| `custom-integration`   | One range input, the snippet `docs/integrate` embeds              | `threshold.set`                                                                                                                                               |

Every example with data registers `vacp.data_sql` and `vacp.data_schema` over DuckDB-Wasm, and `vacp.apply_state` for replay.

The vgplot gallery uses Mosaic's global coordinator, because Mosaic inputs and table prefetches always query it. It creates each provider after the entry's plots render (`plot.update()`), because the adapter builds its interactor and legend bindings when the provider is created.

## The gallery

`examples/gallery` serves every example from one Vite process. `examples.manifest.ts` lists the routes, titles, and module loaders. `scripts/sync-generated.mjs` writes one HTML entry and copies the public assets per route before `dev` and `build`. It writes only changed files, so a running dev server does not reload. Edit the script, never its generated output.

`make build` writes a static site to `examples/gallery/dist`, one directory per route. `VACP_BASE_PATH=/some/path/` builds it for hosting below the domain root. `infra/examples.Dockerfile` serves the same output with nginx. Each route loads the DuckDB-Wasm engine from `dist/assets`, about 34 MB for the exception-handling build, so serve `.wasm` files compressed. The `gaia`, `nyc-taxi-rides`, and `observable-latency` specifications stream data from a remote bucket, and parquet specifications load DuckDB's parquet extension from `extensions.duckdb.org`.

## Source resolution

Every library export has a `vacp-source` condition first, pointing at its source file. `defineExampleConfig({ cacheName, config? })` in `vite.shared.ts` sets `resolve.conditions` to `['vacp-source', ...defaultClientConditions]`, so examples compile workspace packages from source with hot reload, while Node, TypeScript, and published consumers resolve `dist`. It also adds the presence StyleX plugin, the base and HMR paths from `VACP_BASE_PATH`, and the dependency cache from `VACP_VITE_CACHE_DIR`.

## Add an example

1. Create `examples/<name>` with a `package.json` named `@vacp/example-<name>`, its `portless` name, and a `vite.config.ts` that calls `defineExampleConfig`.
2. Export `mount(target)` from the package entry, and compose the runtime through `installExampleRuntime`.
3. Add the route to `examples/gallery/examples.manifest.ts` and the package to the gallery's dependencies.
4. Add a smoke case and behavior specs under `apps/e2e/tests`.
