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

## Source and distribution boundaries

Workspace packages import each other through their public names. Relative TypeScript imports are extensionless. Shared Vite+ Pack configuration emits unbundled ESM and declarations with valid runtime paths. TypeScript checks source with bundler resolution and emits no files. Package manifests expose the distribution, which is validated in native Node and a NodeNext type consumer.

The JavaScript workspace keeps one pnpm catalog and lockfile. The Python workspace keeps its uv sources, lockfile, and QA policy at the repository root. Build policy is shared by the native toolchain configurations. Package consumers require the exported distribution, independent of the development loader or workspace aliases.

## Ports

`VacpProvider` combines a pure `VacpSourceDescription` with a live binding. Its `observe()` method returns one source revision containing an analytical graph fragment, state, summaries, and output freshness. Its `prepare()` method validates an operation and returns semantic intent plus a single-use execution closure. Runtime dispatch owns lifecycle events and optional bounded presentation gates. Optional invalidation and disposal callbacks remain transport-neutral.

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

## Recording and restoration

`createLiveObservations` owns coherent reads, invalidation, and live publication. `createRuntimeHistory` owns recorded copies. Runtime snapshots contain `observation` and `history`; a viewer retains whichever record it wants to inspect. Selecting a record performs no source operation.

`createVacpRestorer` owns a queue of explicit restoration requests. It checks source ownership and unambiguous `vacp.apply_state` contracts before dispatching any action, routes each source only its state, and waits for every source result before starting its next request. Calls go through normal runtime execution and history. Failures report per-source results. Restoration is not a transaction across engines. Unsupported ownership fails before mutation. Provider-specific read-only or transient refs are reported in the provider result. An application may supply the restorer through an Inspector client's optional `restore` port.

Ordinary execution does not coordinate with a viewer's historical selection. State-token baselines are bounded independently of runtime history.

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

The runtime owns capability and observation subscriptions and its lifetime signal. DOM publication subscribes to composed observations, so it preserves execution options and shares lifecycle cleanup with other output adapters. These subscriptions are independent of the runtime history stream. Provider invalidation triggers a new coherent read. Replacing a provider aborts pending calls from its prior binding. Runtime execution forwards caller and source-lifetime cancellation to handlers.

The integration targets upstream WebMCP commit `f5645e9` (2026-09-17), with the mature `webmcp-types` 0.1.7 declarations for its registration surface. Browser verification uses native Chromium APIs, not a polyfill.

## Inspection core

`InspectorClient` identifies one host-owned analytical session and supplies observations. Execution, invalidation, restoration, and reveal are optional capabilities. The root Inspector Core entry point depends on protocol types and platform primitives. Runtime and HTTP connectors sit behind separate entry points.

`createInspectorSession` owns cancellation, observation ordering, operation state, and optional bounded history. Construction and subscription are inert. The host starts the session and disposes it with the inspection surface. Invalidations coalesce while a read is pending. Received observations are cloned and frozen. Source lifetime remains with the host.

`createInspectionIndex` resolves entities, ownership, relationships, freshness, and operations against one observation. UI selection, historical navigation, parameter editing, and result rendering belong to consumers. They can retain a recorded observation independently of the live source. Restoration is an explicit capability and operation.

HTTP clients resolve a session identity before making reads or operations. The Python ASGI endpoint checks that identity on every request. The application owns authentication and authorization.

## Agent presence

`protocol` defines semantic focus, actor context, prepared operations, and execution events. Runtime dispatch emits the same lifecycle for SDK, MCP, and WebMCP calls. Each provider generation has a binding ID and abort signal. Presentation bindings use both to reject stale target lookups.

`presence-core` consumes execution events and coherent observations through ports. It coalesces visual focus per actor and reports output freshness independently of execution success. It never dispatches actions. `presence-browser` implements a passive cursor renderer and live geometry helpers. Adapter `./presentation` entry points project domain targets through their rendering engines. Application modules compose the provider, runtime, and viewer.

Provider `prepare` validates inputs and resolves targets before mutation. `createVacpProvider` delegates preparation to the action registry. Direct execution remains available through `runtime.execute` or `executeVacpAction(provider, call)`. Prepared operations are single-use and cancellation-aware. Action parsers run before optional presentation pacing.

## Native adapter bindings

A binding inventory assigns semantic refs to native resources for one provider generation. VGPlot graph construction, state reads, restoration, and presentation use the same inventory. Operation preparation retains its resolved resource and normalized inputs. Adding a capability extends the owning family; redispatch through reconstructed calls or interpretation of operation-name substrings is unnecessary.

Vega-Lite bindings own parameter identity, watched signals, mark ownership, and native context traversal. Serialized state paths retain nested unit identity. Native scene conversion owns padding, renderer origin, and viewport transforms. Compiler signal allocation remains an adapter detail with native-engine tests.

Restoration uses the same validation and mutation functions as direct operations. `registerVacpApplyStateAction` accepts a preparation function returning an execution closure. Every supported target is prepared before the first mutation. Read-only and transient states are reported as skipped. Failures during effects are reported as partial application. Preparation does not promise rollback.

## Native observation ownership

`createSharedSubscription` connects one resource once while it has consumers and disconnects after the last consumer leaves. The visualization adapters use it for native method instrumentation. Each consumer still owns its invalidation subscription and debounce lifetime. Failed connection setup must release every hook already acquired.

Vega observation retains the exact native `runAsync` promise. VGPlot instrumentation preserves synchronous results and native promises from pending/render/init/update methods. Cleanup restores a method only when the method is still owned by that connection. If a replacement controller cannot be instrumented, native initialization retains its result and invalidates the provider for a fresh read. The application owns destruction of its native view. A provider releases its subscriptions.

## Completion and settlement

| Boundary            | Meaning                                                                     | Evidence                                |
| ------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Prepared            | Inputs and native target are validated. No analytical mutation has occurred | Adapter preparation                     |
| Execution succeeded | The operation's mutation contract completed                                 | Native operation result                 |
| Output current      | A native output represents the reported input revision                      | Run/render completion for that revision |
| Visual arrival      | A presentation reached its resolved target                                  | Renderer arrival callback               |

Vega run completion can witness its output revision. VGPlot requests updates and observes pending/render revisions separately because superseded update promises may never resolve. An update timeout cannot establish current output. A source lacking a settlement witness leaves freshness absent, which consumers display as unknown. Native asynchronous failures are attached to the matching observation generation. Older work must not overwrite a newer revision.

## Presentation authority

`VacpExecutionSource` is passive. `VacpExecutionControl` grants bounded gate registration. Creating a headless or browser presence viewer subscribes to events and observations. A host may separately call `paceAgentPresence(control, viewer, timing)` to grant that viewer pacing authority, then release pacing while keeping the viewer attached. Disposing either owner releases waits. Hosts choose which viewer may pace; additional viewers remain independent observers.
