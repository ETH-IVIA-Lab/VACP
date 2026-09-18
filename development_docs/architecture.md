# Architecture

VACP separates the visualization's state from the ways people and agents access it. A provider reads capabilities and state and executes actions against the host application. The runtime coordinates snapshots and history. Browser and agent adapters expose those operations to consumers.

## Package ownership

| Package             | Owns                                                               | Workspace dependencies                   |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| `protocol`          | Protocol records, refs, hashes, and consumer interfaces            | None                                     |
| `runtime`           | Action registration, snapshot scoping, deltas, history, and replay | `protocol`                               |
| `runtime-browser`   | Browser options, bridge installation, and DOM snapshots            | `protocol`, `runtime`                    |
| `sdk`               | Custom integration builders and browser composition                | `protocol`, `runtime`, `runtime-browser` |
| `data-duckdb`       | Database execution, metadata, serialization, and handle routing    | `protocol`                               |
| `adapter-vega-lite` | Vega-Lite entities, selections, and actions                        | `data-duckdb`, `protocol`, `runtime`     |
| `adapter-vgplot`    | VGPlot entities, selections, and actions                           | `data-duckdb`, `protocol`, `runtime`     |
| `transport-bridge`  | Bridge-to-tool mapping and readiness behavior                      | `protocol`                               |
| `agent-ai-sdk`      | Models, AI SDK tools, agent policy, and context compaction         | `protocol`, `transport-bridge`           |
| `inspector-core`    | Observation sessions, graph indexes, and connection ports          | `protocol`                               |
| `diagram-mermaid`   | Semantic graph to Mermaid source                                   | `protocol`                               |
| `analytics`         | Provider-independent runtime event subscriptions                   | `protocol`                               |
| `analytics-posthog` | PostHog implementation of the telemetry provider port              | `protocol`, `analytics`                  |
| `python`            | Python MCP tools and Playwright browser ownership                  | None                                     |

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

Applications pass browser exposure and SQL enablement explicitly. The browser installer owns one runtime registry regardless of global exposure. Each inspection surface owns its presentation state.

`uninstallVacpRuntime` stops observation, clears subscribers, and removes owned bridge and snapshot state. Disposing an Inspector Core session cancels its requests and releases its source subscription. Applications dispose these resources when their owning view is removed.

## History and replay

Live state remains authoritative. Inspection overrides are separate from host state. Cursor replay uses the provider's `vacp.apply_state` action when available. A serialized replay queue and request identity prevent stale replay from overtaking a request to return live. State-token baselines are bounded independently of runtime history.

Runtime and session metadata are public properties and snapshot fields. Analytics consumes these fields rather than implementation-private properties.

## Documentation

`docs/` contains user-facing concepts, integration guides, examples, and API reference. `apps/docs/` hosts VitePress and public assets. `development_docs/` contains architecture, contribution and test guides. Ignored local experiment artifacts are not published documentation.

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

`protocol`, `runtime`, `sdk`, `analytics`, `inspector-core`, and `python` name the shared contract, engine, integration entry point, event pipeline, inspection primitives, and Python distribution. Keep package directories flat and use the same name in the package manifest, imports, and references.

## WebMCP projection

`@vacp/transport-webmcp` consumes protocol records and structural runtime ports. Its compiler turns a graph into executable tool definitions using an injected client; it does not read browser globals. Its installer owns asynchronous browser registration, incremental replacement, cancellation, and cleanup. Applications opt in by passing their runtime instance. No provider or core package imports WebMCP.

The runtime owns capability and observation subscriptions and its lifetime signal. DOM publication subscribes to composed observations, so it preserves execution options and shares lifecycle cleanup with other output adapters. These subscriptions are independent of the runtime history stream. Provider invalidation triggers a new coherent read. Replacing a provider aborts pending calls from its prior binding. Runtime execution owns return-to-live behavior and forwards cancellation to handlers.

The integration targets upstream WebMCP commit `f5645e9` (2026-09-17), with the mature `webmcp-types` 0.1.7 declarations for its registration surface. Browser verification uses native Chromium APIs, not a polyfill.

## Inspection core

`InspectorClient` identifies one host-owned analytical session and supplies observations. Execution, invalidation, restoration, and reveal are optional capabilities. The root Inspector Core entry point depends on protocol types and platform primitives. Runtime and HTTP connectors sit behind separate entry points.

`createInspectorSession` owns cancellation, observation ordering, operation state, and optional bounded history. Construction and subscription are inert. The host starts the session and disposes it with the inspection surface. Invalidations coalesce while a read is pending. Received observations are cloned and frozen. Source lifetime remains with the host.

`createInspectionIndex` resolves entities, ownership, relationships, freshness, and operations against one observation. UI selection, historical navigation, parameter editing, and result rendering belong to consumers. They can retain a recorded observation independently of the live source. Restoration is an explicit capability and operation.

HTTP clients resolve a session identity before making reads or operations. The Python ASGI endpoint checks that identity on every request. The application owns authentication and authorization.
