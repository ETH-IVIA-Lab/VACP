# Architecture

VACP separates the visualization's state from the ways people and agents access it. A provider reads capabilities and state and executes actions against the host application. The runtime coordinates snapshots and history. Browser and agent adapters expose those operations to consumers.

## Package ownership

| Package             | Owns                                                                           | Workspace dependencies                                                    |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `protocol`          | Protocol records, refs, hashes, and consumer interfaces                        | None                                                                      |
| `runtime`           | Action registration, observations, deltas, provenance journal, and restoration | `protocol`                                                                |
| `provenance-core`   | Checkpoint projection and viewer-owned replay                                  | `protocol`                                                                |
| `presence-core`     | Agent activity, target resolution, and presentation arbitration                | `protocol`, `provenance-core`                                             |
| `presence-browser`  | React overlay for cursors and bubbles, viewport geometry, and Streamdown text  | `protocol`, `presence-core`                                               |
| `runtime-browser`   | Browser options, bridge installation, and DOM snapshots                        | `protocol`, `runtime`                                                     |
| `sdk`               | Custom integration builders and browser composition                            | `protocol`, `runtime`, `runtime-browser`                                  |
| `data-duckdb`       | Database execution, metadata, serialization, and handle routing                | `protocol`                                                                |
| `adapter-vega-lite` | Vega-Lite entities, selections, and actions                                    | `data-duckdb`, `protocol`, `runtime`, `presence-core`, `presence-browser` |
| `adapter-vgplot`    | VGPlot entities, selections, and actions                                       | `data-duckdb`, `protocol`, `runtime`, `presence-core`, `presence-browser` |
| `transport-webmcp`  | Native tool projection and browser registration                                | `protocol`                                                                |
| `transport-bridge`  | Bridge-to-tool mapping                                                         | `protocol`                                                                |
| `agent-ai-sdk`      | Models, AI SDK tools, agent policy, and context compaction                     | `protocol`, `transport-bridge`                                            |
| `inspector-core`    | Observation sessions, graph indexes, and connection ports                      | `protocol`                                                                |
| `diagram-mermaid`   | Semantic graph to Mermaid source                                               | `protocol`                                                                |
| `analytics`         | Provider-independent runtime event subscriptions                               | `protocol`, `provenance-core`                                             |
| `analytics-posthog` | PostHog implementation of the telemetry provider port                          | `protocol`, `analytics`                                                   |
| `python`            | Python MCP tools and Playwright browser ownership                              | None                                                                      |

Applications and examples choose adapters and own their lifecycle. Runtime and protocol source must not access browser globals or import providers, databases, model SDKs, or UI code. Import restrictions in `vite.config.ts` enforce workspace dependency direction.

## Source and distribution boundaries

Workspace packages import each other through their public names. Relative TypeScript imports are extensionless. Shared Vite+ Pack configuration emits unbundled ESM and declarations with valid runtime paths. TypeScript checks source with bundler resolution and emits no files. Package manifests expose the distribution, which is validated in native Node and a NodeNext type consumer.

The JavaScript workspace keeps one pnpm catalog and lockfile. The Python workspace keeps its uv sources, lockfile, and QA policy at the repository root. Build policy is shared by the native toolchain configurations. Package consumers require the exported distribution, independent of the development loader or workspace aliases.

## Ports

`VacpProvider` combines a pure `VacpSourceDescription` with a live binding. Its `observe()` method returns one source revision containing an analytical graph fragment, state, summaries, and output freshness. Its `prepare()` method validates an operation and returns semantic intent plus a single-use execution closure. Runtime dispatch owns lifecycle events and optional bounded presentation gates. Optional invalidation and disposal callbacks remain transport-neutral.

`createVacpProvider` binds a source description, an analytical projector, and an action preparation port. The projector owns the complete graph, including current action descriptions. Execution binding preserves that projection. Discovery adapters can describe source facts before a live binding exists. Profiles can enrich those facts with selections, data handles, visualizations, and analytical relationships.

`composeVacpProviders` validates one owner per node and action, permits cross-source edges, routes action calls to their owner, and retries observations invalidated during a read. The composed graph publishes source descriptions and ownership maps.

`VacpWindowBridge.observe()` is the canonical coherent read. Capability and state methods provide scoped projections for compact consumers. `VacpRuntimeBridge` adds provenance and inspection capabilities. `VacpRuntime` adds provider attachment, source removal, session replacement, invalidation subscriptions, and disposal.

`VacpTransport` maps the bridge to the agent tools other than `vacp_progress`, independently of any model SDK. `VacpDuckDbClient` is the database adapter contract used by providers and data actions.

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

`createLiveObservations` owns coherent reads, invalidation, and live publication. The runtime provenance journal owns record identity, retention, epoch/revision ordering, and immutability: each record is cloned once, deeply frozen, and shared by every reader. Consumers mirror appended records by revision and resynchronize from `getProvenance()` only after an epoch change or a revision gap. `getProvenance()` reads that journal synchronously. `subscribeProvenance()` publishes appended records or an epoch reset. `inspect()` reads the live full observation separately.

`VacpProvenanceRecord` is a discriminated union of actions, observations, and session markers. An action owns its terminal execution, with the step's narration, and its call, result, and available before/after observations. Actor and focus come from its execution. Observation records carry explicit actor and cause evidence. Unattributed native changes remain system observations. Concurrent observations list overlapping executions without claiming exclusive causality. Failed payload capture preserves the known action outcome and records `captureErrors`.

Dispatch captures before-state after preparation and bounded gates, immediately before effects. Terminal recording happens once. Later cancellation, read failure, or presentation failure cannot replace a known operation outcome. Session epochs prevent late reads from entering a newer journal.

`provenance-core` owns analytical state comparison, metadata accessors, and checkpoint projection. Projection classifies the complete chronology before consumer filtering. It retains changed effects from failed operations and excludes queries, restoration records, and intermediate concurrent evidence. A checkpoint refers to its original record rather than copying actor or action metadata.

`createProvenanceReplay` owns a viewer's selected checkpoint, review trail, and saved return observation. Its host supplies restoration separately. It reads retention from the runtime journal and owns no second bounded recording. The controller accepts checkpoint IDs. Actor filters and arrow navigation belong to the consuming UI. Foreign mutations, changed external observations, and session resets interrupt review. Hosts can call `interrupt()` at native input intent to cancel a pending restore before a later observation can detect that input. Interruption abandons the saved return state, and cannot roll back effects already applied.

`createVacpRestorer` owns a queue of explicit restoration requests. It checks complete source ownership through `inspect()` and unambiguous `vacp.apply_state` contracts before dispatching any action, routes each source only its state, and waits for every source result before starting its next request. Calls go through normal runtime execution and history, including current action availability checks. Full inspection supplies ownership, never an execution bypass. Failures report per-source results. Restoration is not a transaction across engines. Unsupported ownership fails before mutation. Provider-specific read-only or transient refs are reported in the provider result. An application may supply the restorer through an Inspector client's optional `restore` port.

Ordinary execution does not coordinate with a viewer's historical selection. State-token baselines are bounded independently of runtime history.

Runtime and session metadata are public properties and journal fields. Analytics subscribes to the canonical journal and uses provenance accessors for record metadata.

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

`protocol`, `runtime`, `sdk`, `analytics`, `inspector-core`, `provenance-core`, and `python` name the shared contract, engine, integration entry point, event pipeline, inspection primitives, provenance consumers, and Python distribution. Keep package directories flat and use the same name in the package manifest, imports, and references.

## WebMCP projection

`@vacp/transport-webmcp` consumes protocol records and structural runtime ports. Its compiler turns a graph into executable tool definitions using an injected client. Its installer owns asynchronous browser registration, incremental replacement, cancellation, and cleanup. Applications opt in by passing their runtime instance. No provider or core package imports WebMCP.

Graph reads that reach a model leave out source ownership, which routes execution and stays in runtime and inspection reads. `vacpToolRead` in `protocol` owns the projection, and the Python server's `tool_read` matches it through `protocol/test/fixtures/tool-read.json`. WebMCP registers each available action as a tool and also leaves actions out of `vacp.observe` and `vacp.capabilities`. The bridge transport and the Python MCP server keep them for `vacp_execute`.

The five agent tools, `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_execute`, and `vacp_progress`, are one contract in `protocol`: `vacpAgentTools` holds their names, input fields, and descriptions, `vacpAgentToolGuidance` their shared guidance, and `vacpToolCapabilitiesRequest` and `vacpToolStateRequest` turn tool input into requests. `createVacpTransport` applies those requests and `vacpToolRead`, as the Python server does. `@vacp/agent-ai-sdk` and the Python MCP server both check their tools against `protocol/test/fixtures/agent-tools.json`.

The runtime owns capability and observation subscriptions and its lifetime signal. DOM publication subscribes to composed observations, so it preserves execution options and shares lifecycle cleanup with other output adapters. These subscriptions are independent of the runtime history stream. Provider invalidation triggers a new coherent read. Replacing a provider aborts pending calls from its prior binding. Runtime execution forwards caller and source-lifetime cancellation to handlers.

The integration targets upstream WebMCP commit `f5645e9` (2026-09-17), with the mature `webmcp-types` 0.1.7 declarations for its registration surface. Browser verification uses native Chromium APIs, not a polyfill.

## Inspection core

`InspectorClient` identifies one host-owned analytical session and supplies observations. Execution, invalidation, restoration, and reveal are optional capabilities. The root Inspector Core entry point depends on protocol types and platform primitives. Runtime and HTTP connectors sit behind separate entry points.

`createInspectorSession` owns cancellation, observation ordering, operation state, and optional bounded history. Construction and subscription are inert. The host starts the session and disposes it with the inspection surface. Invalidations coalesce while a read is pending. Received observations are cloned and frozen. Source lifetime remains with the host.

`createInspectionIndex` resolves entities, ownership, relationships, freshness, and operations against one observation. UI selection, historical navigation, parameter editing, and result rendering belong to consumers. They can retain a recorded observation independently of the live source. Restoration is an explicit capability and operation.

HTTP clients resolve a session identity before making reads or operations. The Python ASGI endpoint checks that identity on every request. The application owns authentication and authorization.

## Agent presence

Hosts use `VacpAgentActivityControl` to begin, update, and end public progress. The runtime broadcasts these ephemeral records through `VacpAgentActivitySource`, separately from analytical snapshots and history. The protocol carries actor identity and a short summary. An execution's `narration` is that step's own sentence, fixed at acceptance from the caller's `narration`, or from the actor's live summary when no earlier step of the turn carried it. `narrate()` runs one turn per actor for agents without a lifecycle of their own. An agent's execution with no turn open opens that turn, so a request that starts with a step still has one turn. Sentences and steps both keep the turn open, and a quiet turn closes once the actor has no execution in flight. A finished turn is recorded before its completion is published, so a viewer finds the conclusion as the live entry goes idle. It carries no browser geometry or model reasoning tokens. Viewers merge progress and execution by actor, and ignore completions from executions superseded by a newer host turn. A summary that arrives between an actor's steps waits in the viewer until the next execution begins, bounded by `narrationHoldMs`, so words and cursor movement start together. Ending a turn without a summary keeps the last one. Browser hover, spring motion, bloom, and bubble layout remain renderer policy.

`protocol` defines semantic focus, actor context, prepared operations, and execution events. Runtime dispatch emits the same lifecycle for SDK, MCP, and WebMCP calls. Each provider generation has a binding ID and abort signal. Presentation bindings use both to reject stale target lookups.

`presence-core` consumes host activity, execution events, and coherent observations through passive ports. Presentation groups recorded steps into requests by their turn's `activityId` and shows one request as frames: the checkpoint before its first step, each step, and the `turn` record's conclusion, which is the live state. Each actor has one entry holding the host's progress record, the shown execution, where the cursor rests, and its target; every published `PresenceActivity` is a projection of that entry. One actor predicate controls live, retained, and replayed presentation, with agent actors visible by default. One presentation coordinator selects the frame, and one target registry resolves live and historical semantic focus. `PresenceFrame` carries displayed activities, layout/activity cause, and optional navigation. Live activity subscribers remain independent of historical presentation.

A host can supply an independently owned `ProvenanceReplayController` to presence. Presence renders navigation and selects checkpoints through that controller. It neither constructs nor disposes the controller. Runtime and provenance packages remain independent of presence. Restoration correlations stay in protocol execution and journal records.

`presence-browser` owns cursor motion, contextual bubble placement, and content rendering. Its renderer commits each presence frame synchronously into a React root in a shadow root. The renderer turns frames into immutable pointer slots, which keep a pointer's identity when a finished turn hands it to the recorded trail. React renders cursors, cues, labels, and the trail from those slots. A pointer is a resting point, an optional flight toward it, and the located geometry its label sits beside. Each pointer's motion controller owns that state and is the only writer of its geometry. It writes transforms on animation frames, outside React renders. Components are styled with StyleX. The workspace plugin in `tools/stylex/shadow-sheet.ts` compiles them for `vp pack` and for example apps that alias the package source, and the renderer adopts the compiled sheet into its shadow root. Authoritative public text updates accept appends and corrections. Exact duplicates preserve rendering identity. Browser installation owns viewport and nested scroll invalidation. Provider geometry subscriptions observe native surface changes. Targets use viewport coordinates clipped to visible scroll ancestors. The same target refresh path serves live activity, retained feedback, and replay.

Adapter `./presentation` entry points borrow the provider generation's binding inventory through `{ provider, root }`. Applications compose providers, runtime, restoration, replay, and optional presence. `examples/shared` centralizes the examples' Streamdown and replay policy, including native input interruption and lifecycle cleanup.

Provider `prepare` validates inputs and resolves targets before mutation. `createVacpProvider` delegates preparation to the action registry. Direct execution remains available through `runtime.execute` or `executeVacpAction(provider, call)`. Prepared operations are single-use and cancellation-aware. Action parsers run before optional presentation pacing.

## Native adapter bindings

A binding inventory assigns semantic refs to native resources for one provider generation. Graph construction, state reads, execution, restoration, native observation, and optional presentation use the adapter-owned inventory. Operation preparation retains its resolved resource and normalized inputs. Adding a capability extends the owning family through its binding.

VGPlot classifies interactors, legend handlers, and inputs once, by Mosaic class identity, in its binding inventory, because constructor names do not survive minification. VGPlot inventories each shared native Mosaic selection once. Its state records `activeSource` as a bound interaction ref or `null`, because active-clause identity affects crossfilter output independently of clause values. Restoration applies clause values before active-source identity. An unrepresented native source leaves that field undefined and restoration reports the entry as skipped. This native state contract belongs to the adapter. The provenance journal and checkpoint model retain it as ordinary provider state.

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

`VacpExecutionSource` is passive. `VacpExecutionControl` grants bounded gate registration. Creating a headless or browser presence viewer subscribes to events and observations. A host may separately call `paceAgentPresence(control, viewer, timing)` to grant that viewer pacing authority, then release pacing while keeping the viewer attached. Disposing either owner releases waits. Hosts choose which viewer may pace. Additional viewers remain independent observers.

## Observation work

Every runtime read still consults the source and preserves consumer isolation. Capability publication reuses its graph fingerprint when the analytical revision and source descriptions are unchanged. A provider revision covers its graph, state, summary, and freshness. `createVacpProvider` computes a content revision when none is supplied. Host-supplied revisions cover the complete projection, including action descriptions and availability.

Vega parameter projection reads one native snapshot and indexes its signal scopes once per observation. Root scope precedence and direct-signal fallback remain explicit in the binding. Presence discards superseded geometry work before invoking the resolver, while the execution stream retains every semantic operation.

## Capability availability

Providers publish their complete current catalog with `availability.requires` and optional `availability.unavailable` reasons. The protocol resolver owns conjunctive prerequisites, cycle and missing-ref validation, disclosure, and execution eligibility. Effects, inputs, and containment do not implicitly become prerequisites.

Composition and runtime expose `observe()` for the disclosed surface and `inspect()` for the complete observation. One runtime read retains both views. The disclosed observation enters capability/state subscriptions and DOM snapshots. Provenance records retain the complete observation. Inspection clients use `inspect()` and cannot bypass execution guards.

Runtime dispatch checks availability before preparation and again after preparation and presentation waits. Native effects that follow provider-owned asynchronous work remain the provider's responsibility. WebMCP projects the disclosed catalog and invocation rechecks live eligibility, including while registration catches up with a state change. Python composition follows the same contract, checked by fixtures shared with the TypeScript protocol suite.

## Interaction presentation

Validated focus may carry a small optional interaction hint (kind, axis, direction). Providers own that meaning. Presence-core transports it unchanged, including custom kinds. Browser cursor selection and inline vector assets belong to presence-browser. Glyph hotspots, travel scale, and press feedback use separate SVG transforms. Visual arrival and gesture feedback never authorize or delay an operation unless the host has installed pacing.
