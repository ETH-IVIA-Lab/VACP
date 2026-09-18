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

`VacpSnapshotProvider` supplies capabilities and state. `VacpActionExecutor` lists descriptors and executes calls. `VacpActionRegistrar` accepts descriptors and handlers. Runtime registration helpers depend on the registrar port, and runtime creation depends on the executor port. `VacpActionRegistry` is one implementation.

`VacpWindowBridge` defines the three protocol operations. `VacpRuntimeBridge` adds optional history and observation capabilities for consumers. `VacpRuntime` is the concrete runtime's public lifecycle interface with required runtime methods, `update`, and `dispose`.

`VacpTransport` defines the three agent tools independently of any model SDK. `VacpDuckDbClient` is the database adapter contract used by providers and data actions.

## Runtime flow

1. The application changes its own state through human input or an action handler.
2. Snapshot ports read that state. Capabilities list registered actions.
3. The runtime records snapshots and action results, scopes reads, and computes delta tokens.
4. Inspector, transport, and analytics consumers read the same public bridge.

The action registry checks action existence and converts handler failures into result envelopes. Standard registration helpers validate common parameter envelopes. Custom handlers validate application-specific parameters before mutation.

## Browser installation

`installVacpRuntime` owns global exposure and DOM snapshot publication. Reinstallation at one key updates the existing runtime's ports. A changed session key establishes a new history boundary. Browser-only snapshot hooks are stored in a WeakMap owned by the browser adapter.

Browser configuration resolves URL, environment, storage, and default values. Integrations pass SQL enablement explicitly to runtime registration. Runtime code never reads browser policy.

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
