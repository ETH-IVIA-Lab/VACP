# Architecture

VACP separates the visualization's state from the ways people and agents access it. A provider reads capabilities and state and executes actions against the host application. The runtime coordinates snapshots and history. Browser and agent adapters expose those operations to consumers.

## Package ownership

| Package             | Owns                                                               | Workspace dependencies                                                               |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `protocol`          | Protocol records, refs, hashes, and consumer interfaces            | None                                                                                 |
| `runtime`           | Action registration, snapshot scoping, deltas, history, and replay | `protocol`                                                                           |
| `runtime-browser`   | Browser options, bridge installation, and DOM snapshots            | `protocol`, `runtime`                                                                |
| `sdk`               | Custom integration builders and browser composition                | `protocol`, `runtime`, `runtime-browser`                                             |
| `data-duckdb`       | Database execution, metadata, serialization, and handle routing    | `protocol`                                                                           |
| `adapter-vega-lite` | Vega-Lite entities, selections, and actions                        | `data-duckdb`, `protocol`, `runtime`, `runtime-browser`                              |
| `adapter-vgplot`    | VGPlot entities, selections, and actions                           | `data-duckdb`, `protocol`, `runtime`, `runtime-browser`                              |
| `transport-bridge`  | Bridge-to-tool mapping and readiness behavior                      | `protocol`                                                                           |
| `agent-ai-sdk`      | Models, AI SDK tools, agent policy, and context compaction         | `protocol`, `transport-bridge`                                                       |
| `inspector`         | React inspection UI and agent conversations                        | `agent-ai-sdk`, `diagram-mermaid`, `protocol`, `runtime-browser`, `transport-bridge` |
| `diagram-mermaid`   | Semantic graph to Mermaid source                                   | `protocol`                                                                           |
| `analytics`         | Provider-independent runtime event subscriptions                   | `protocol`                                                                           |
| `analytics-posthog` | PostHog implementation of the telemetry provider port              | `protocol`, `analytics`                                                              |
| `python`            | Python MCP tools and Playwright browser ownership                  | None                                                                                 |

Applications and examples choose adapters and own their lifecycle. Runtime and protocol source must not access browser globals or import providers, databases, model SDKs, or UI code. Import restrictions in `vite.config.ts` enforce workspace dependency direction.

## Ports

`VacpProvider` combines a pure `VacpSourceDescription` with a live binding. Its `observe()` method returns one source revision containing an analytical graph fragment, state, summaries, and output freshness. Its `execute()` method invokes source-owned semantic operations. Optional invalidation and disposal callbacks remain transport-neutral.

`createVacpProvider` binds a source description, an analytical projector, and a `VacpActionExecutor`. Discovery adapters can describe source facts before a live binding exists. Profiles can enrich those facts with selections, data handles, visualizations, and analytical relationships.

`composeVacpProviders` validates one owner per node and action, permits cross-source edges, routes action calls to their owner, and retries observations invalidated during a read. The composed graph publishes source descriptions and ownership maps.

`VacpWindowBridge.observe()` is the canonical coherent read. Capability and state methods provide scoped projections for compact consumers. `VacpRuntimeBridge` adds history and inspection capabilities. `VacpRuntime` adds provider attachment, source removal, session replacement, invalidation subscriptions, and disposal.

`VacpTransport` defines the four agent tools independently of any model SDK. `VacpDuckDbClient` is the database adapter contract used by providers and data actions.

## Runtime flow

1. A provider describes its source and projects its current analytical graph, state, summaries, and freshness.
2. The composer reads every provider at a stable invalidation epoch and records source ownership.
3. The runtime records observations and operation results, scopes capability and state views, and computes state delta tokens.
4. Inspector, transport, and analytics consumers read the same public bridge.

The action registry checks action existence and converts handler failures into result envelopes. Standard registration helpers validate common parameter envelopes. Custom handlers validate application-specific parameters before mutation.

## Browser installation

`installVacpRuntime` owns global exposure and DOM observation publication. Sources with distinct IDs compose at one key. Reinstalling one source ID replaces that binding while preserving unrelated providers. A changed session key replaces the source set and establishes a new history boundary. Browser-only publication hooks are stored in a WeakMap owned by the browser adapter.

Applications pass browser exposure and SQL enablement explicitly. The browser installer owns one runtime registry regardless of global exposure. Example context profiles select evaluation surfaces at the application boundary. Inspector preferences store presentation state.

`uninstallVacpRuntime` stops observation, clears subscribers, and removes owned bridge and snapshot state. Inspector installation returns a disposal handle that unmounts React and clears its query cache. Applications dispose these resources when their owning view is removed.

## History and replay

Live state remains authoritative. Inspection overrides are separate from host state. Cursor replay uses the provider's `vacp.apply_state` action when available. A serialized replay queue and request identity prevent stale replay from overtaking a request to return live. State-token baselines are bounded independently of runtime history.

Runtime and session metadata are public properties and snapshot fields. Analytics consumes these fields rather than implementation-private properties.

## Evaluation applications

`evals/agent-arena` separates CLI/config loading, job scheduling, transcript analysis, statistics, and report rendering. Its report templates remain private application code. `evals/arena-analysis` owns Python state extraction and verification. `evals/plain-mcp` owns the research comparison tool surface and use-case registry. These applications consume supported interfaces and remain outside reusable runtime packages.

## Documentation

`docs/` contains user-facing concepts, integration guides, examples, and API reference. `apps/docs/` hosts VitePress and public assets. `development_docs/` contains architecture, contribution and test guides. Evaluation guides live in `evals/docs/`. Ignored local experiment artifacts are not published documentation.

## Evaluation boundary

`evals/*` remain members of the root pnpm and uv workspaces, sharing the root catalogs and lockfiles. Product packages and examples must not import evaluation code. Evaluation consumes an application URL and the declared `vacp` package dependency. Its configuration resolves paths from its own directory. Extraction into another repository therefore requires workspace/toolchain setup and a source for the MCP package, rather than changes to product internals.

## Naming

Names group implementations by capability family:

- `adapter-*`: visualization adapters, currently Vega-Lite and VGPlot.
- `diagram-*`: graph representation, currently Mermaid.
- `analytics-*`: analytics providers, currently PostHog, built on `analytics`.
- `data-*`: data access implementations, currently DuckDB.
- `agent-*`: agent orchestration, currently AI SDK.
- `transport-*`: protocol-to-agent transport implementations.
- `runtime-*`: runtime hosting, currently browser installation.
- `config-*`: shared development tooling.

`protocol`, `runtime`, `sdk`, `analytics`, `inspector`, and `python` name the shared contract, engine, integration entry point, event pipeline, user feature, and Python distribution. Keep package directories flat and use the same name in the package manifest, imports, and references.

## WebMCP projection

`@vacp/transport-webmcp` consumes protocol records and structural runtime ports. Its compiler turns a graph into executable tool definitions using an injected client; it does not read browser globals. Its installer owns asynchronous browser registration, incremental replacement, cancellation, and cleanup. Applications opt in by passing their runtime instance. No provider or core package imports WebMCP.

The runtime owns capability and observation subscriptions and its lifetime signal. DOM publication subscribes to composed observations, so it preserves execution options and shares lifecycle cleanup with other output adapters. These subscriptions are independent of the Inspector history stream. Provider invalidation triggers a new coherent read. Replacing a provider aborts pending calls from its prior binding. Runtime execution owns return-to-live behavior and forwards cancellation to handlers.

The integration targets upstream WebMCP commit `f5645e9` (2026-09-17), with the mature `webmcp-types` 0.1.7 declarations for its registration surface. Browser verification uses native Chromium APIs, not a polyfill.
