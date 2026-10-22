# Architecture

VACP keeps one model of an analysis that people and agents share. Providers translate each analytical source into protocol records, the runtime composes them and owns execution and history, and transports and viewers consume the runtime without owning analytical state.

## Packages

| Package             | Owns                                                                                     | Workspace dependencies                                |
| ------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `protocol`          | Records, contracts, availability resolution, tool contract, narration, shared primitives | none                                                  |
| `runtime`           | Composition, dispatch, provenance journal, activity, restoration, standard operations    | `protocol`                                            |
| `runtime-browser`   | Global installation, bridge lookup, DOM snapshots                                        | `protocol`, `runtime`                                 |
| `sdk`               | Zod operation builder and ref builder                                                    | `protocol`, `runtime`                                 |
| `data-duckdb`       | DuckDB clients, SQL and schema handlers, metadata                                        | `protocol`                                            |
| `adapter-vega-lite` | Vega-Lite bindings, state, operations, presentation                                      | `protocol`, `runtime`, `data-duckdb`, `presence-core` |
| `adapter-vgplot`    | Mosaic bindings, state, operations, presentation                                         | `protocol`, `runtime`, `data-duckdb`, `presence-core` |
| `transport-bridge`  | The five agent tools over a bridge                                                       | `protocol`                                            |
| `transport-webmcp`  | WebMCP tool compilation and registration                                                 | `protocol`                                            |
| `agent-ai-sdk`      | AI SDK tools, agent, chat transport, context compaction                                  | `protocol`, `transport-bridge`                        |
| `provenance-core`   | Checkpoint projection, value attribution, and replay controllers                         | `protocol`                                            |
| `presence-core`     | Headless presence, target resolution, pacing, DOM geometry (`./dom`)                     | `protocol`, `provenance-core`                         |
| `presence-browser`  | React overlay in a shadow root, StyleX styles, Streamdown text                           | `presence-core`                                       |
| `inspector-core`    | Inspection sessions, graph index, runtime and HTTP clients                               | `protocol`                                            |
| `analytics`         | Provenance-to-telemetry delivery                                                         | `protocol`                                            |
| `analytics-posthog` | PostHog provider                                                                         | `analytics`                                           |
| `python`            | MCP server, Python providers and composition, HTTP inspection endpoint                   | none                                                  |

Dependencies point inward to `protocol`. The `no-restricted-imports` table in `vite.config.ts` enforces this direction, and an adapter's `src/presentation.ts` alone may import `presence-core`. Protocol and runtime read no browser globals, URL flags, environment, or storage. Applications compose providers, transports, and viewers, and pass exposure and SQL policy explicitly.

## Providers

A `VacpProvider` has a `source`, `observe()`, `prepare(call, options)`, `subscribe(invalidate)`, and optional `dispose()`. `createVacpProvider` builds one from a projection: `project()` returns the complete graph fragment with action descriptors, state, summary, and freshness, and the provider derives a content revision when none is given.

Discovery adapters infer mechanical facts: names, types, bounds, synchronized values. Analytical meaning, such as which control filters which data, comes from library or application profiles. Containment, effects, and inputs never imply prerequisites.

### Native bindings

Each adapter builds one binding inventory per provider generation. Discovery, state, execution, restoration, native observation, and presentation all resolve native objects through it. Consumers use refs and never decode ref paths. The vgplot adapter classifies interactors, legends, and inputs by Mosaic class identity, because constructor names do not survive minification. Mosaic and Vega therefore sit in the pnpm catalog and as adapter peers, so the application and the adapters share one copy.

### Observation ownership

`createSharedSubscription` connects one native resource once while it has consumers. `createProviderSubscription` binds lazily, coalesces notifications within its `quietMs`, 120 ms in the visualization adapters, and isolates listener failures. Instrumentation preserves native return values and promise identity, restores only methods it still owns, and releases every acquired hook when setup fails. Borrowing a visualization never grants permission to finalize it.

### Completion and freshness

| Boundary            | Meaning                                                 | Evidence                                  |
| ------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Prepared            | Inputs and native target are validated, nothing changed | Adapter preparation                       |
| Execution succeeded | The operation's change completed                        | Native operation result                   |
| Output current      | A native output represents the reported input revision  | A run or render witness for that revision |
| Visual arrival      | A presentation reached its target                       | Renderer arrival callback                 |

A provider reports `current` only from a native witness. Vega run completion witnesses its output. vgplot observes pending and render revisions separately, because superseded update promises may never resolve. Elapsed time never establishes settlement. A provider without a witness leaves freshness absent, which consumers read as unknown.

## Composition and reads

`composeVacpProviders` checks one owner per node and operation, allows edges across sources, and retries a read when a provider invalidates during it. The runtime reads at a stable invalidation epoch and resolves availability once per read: `observe()`, `getCapabilities()`, and `getState()` disclose the available surface, and `inspect()` returns the complete catalog. Every read returns a Promise.

State reads share one envelope. A read without `since`, or with an unknown token, is full and carries a `token`. Tokens hash ref membership as well as values, so an absent ref and a ref holding `undefined` never alias. The runtime keeps a bounded cache of token baselines, independent of history.

Unattributed changes are recorded only from provider invalidation. `refresh({ actor })` records host-attributed changes. Explicit reads record nothing.

## Execution

`runtime.execute` resolves the owner, checks availability, prepares, waits for bounded execution gates, checks availability again, and executes once. The runtime owns call IDs: it assigns one at acceptance when the caller's `callId` is absent, null, or blank, by the whitespace set narration trims, and keeps any other as written. The Python `ProviderComposer` applies the same rule, and transports pass a caller's ID through. Preparation validates every input and resolves its native target before any change, and its closure is single-use. Dispatch captures the before-state immediately before effects and records the terminal outcome once. A later cancellation, read failure, or presentation failure cannot replace a known result. Error details carry a `VacpActionError`'s details or a thrown JSON primitive. Any other error contributes its message.

Execution options belong to the host: `actor`, `narration`, `signal`, and `restoration` never come from model parameters. `runtime.execute` resolves the actor once, `vacpAgentActor` when the caller names none, and prepared executions and handlers receive it in a `VacpActionExecutionContext`. Cancellation combines the caller's signal with the provider generation's lifetime. Replacing a provider aborts calls pending on its old binding.

`executeVacpAction(provider, call, context)` is the one lifecycle-free path, for testing a provider.

## Narration and turns

The narration contract lives once in `protocol`: the guidance text, `parseVacpNarration` (trimmed, at most 280 code points, one whitespace set shared with Python), and the progress tool's fields. The bridge and AI SDK transports offer the same five tools. The Python CLI adds page navigation and page info, and WebMCP projects each operation as its own tool. Every progress tool speaks through `runtime.narrate()`.

One request is one turn. `narrate` opens a turn when none is open, joins one a host opened with `beginAgentActivity`, and closes it on `done`. An agent's first execution without an open turn opens one, so every step shares the turn's `activityId`. A turn that narration or a first step opened closes after 60 seconds with no sentence and no step, once the actor has no execution in flight. A host closes a turn it opened with `beginAgentActivity` itself. An execution's `narration` is fixed at acceptance: the call's own sentence, or the actor's live words no earlier step carried. A finished turn is recorded as a `turn` record before its completion is published.

`vacpAgentActor` is the default actor of every transport, pinned in `agent-tools.json` for Python.

## Provenance and restoration

The journal owns record identity, retention, epochs, and revisions. Each record is cloned once at capture, deeply frozen, and shared by every reader. A record holding mutable built-ins such as `Date` or `Map` gives each reader its own copy. Consumers mirror appended records by revision and resynchronize only after an epoch change or a revision gap. Observation records carry an explicit actor and cause, and concurrent observations list overlapping executions without claiming causality.

`provenance-core` projects checkpoints over the whole chronology before any actor filter. `provenanceAttribution` walks the same chronology for one ref, including the queries, restorations, and `before` states that checkpoint projection skips, and names the record that set its current value. A restoration gives each value back to the owner the ref had when it last held that value. The [reference](../docs/api/provenance.md#provenanceattribution) lists the rule for every record kind. A replay controller owns one viewer's selection, review trail, and saved return state, keeps only scalar epoch and revision cursors, and reads retention from the journal. Restoration is a separate capability, `VacpRestore`, supplied by the host. `createVacpRestorer` routes each source its state through `vacp.apply_state`, runs as `vacpHumanActor`, waits for every source, and reports per-source results. It is not a transaction across engines.

## Presence

Viewers are passive. `VacpExecutionSource` and the activity source grant no execution authority. `paceAgentPresence` separately grants one viewer bounded gates, and only executions that viewer shows wait. Gates are bounded, disposable, and cannot change a known result.

`presence.attach(provider, presentation)` takes the binding identity from `runtime.getProviderBinding(provider)`, so stale target lookups for a replaced provider are rejected. Presentations resolve focus to viewport geometry through `@ethivia/vacp-presence/dom` helpers. `presence-browser` commits each frame into a React root inside a shadow root. Each pointer's motion controller is the only writer of its geometry and writes transforms on animation frames, outside React renders. The StyleX plugin in `tools/stylex/shadow-sheet.ts` compiles presence styles into a sheet the renderer adopts.

## Inspection

An `InspectorClient` identifies one host-owned session. `createInspectorSession` owns request ordering, cancellation, operation state, and optional bounded history. Construction and subscription are inert. Invalidations coalesce while a read is pending, and superseded reads never publish. The runtime client invalidates on runtime snapshots and reads `inspect()`. Restoration and reveal are optional client capabilities.

## Transports

`createVacpTransport`, WebMCP, and the Python MCP server map the same tool contract onto a bridge. Graph reads that reach a model omit source ownership (`vacpToolRead`), and every result passes `vacpToolResult`, whose bounds the Python `tool_result` shares through `protocol/test/fixtures`. WebMCP registers one tool per available operation, keeps registration lifetime separate from a running call, and returns a completed result even when the caller aborts afterwards.

## Applications

The examples compose providers, the runtime, presence, replay, WebMCP, and analytics through `installExampleRuntime` in `examples/shared`, and choose exposure and SQL policy in `examples/shared/config.ts`. They resolve workspace packages from source through the `vacp-source` export condition. See [examples](examples.md).

## Packaging

Libraries build with `vp pack` from the root `pack` block: unbundled ESM and declarations. TypeScript checks with bundler resolution and emits nothing. `make test-package-imports` imports every public entry in native Node and type-checks it from a strict NodeNext consumer.
