# Architecture audit

The audit follows each workspace package's entry points, dependencies, state ownership, and consumer paths. It covers the JavaScript runtime and providers, Inspector, model and MCP transports, examples, evaluation applications, build tooling, and documentation. Generated bundles, dependency caches, credentials, and ignored experiment artifacts are excluded from source review.

The initial public documentation set contained 13 site pages. Architecture, contribution, evaluation, test, and example-authoring guides are classified as development material. Package READMEs describe package capabilities and point to the appropriate public or development guide.

## Boundary decisions

| Finding                                                                 | Current owner and contract                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol definitions read browser storage, URL, and environment flags   | Applications pass exposure options to `@vacp/runtime-browser`. The protocol package contains platform-independent protocol records and utilities.     |
| Runtime construction and browser installation shared one package        | `@vacp/runtime` creates runtimes. `@vacp/runtime-browser` installs and discovers them.                                                                |
| Runtime signatures required a concrete registry with private state      | Snapshot, execution, and registration ports accept structural implementations.                                                                        |
| Several constructors and installers overlapped                          | `createVacpRuntime` is the runtime constructor, `installVacpRuntime` is browser composition, and `installVacp` is the custom-integration entry point. |
| SQL action registration read global browser flags                       | Runtime registration accepts explicit enablement. Browser integrations resolve policy.                                                                |
| Custom integration helpers imported DuckDB                              | Data-handle routing lives in `@vacp/data-duckdb`. The SDK composes runtime and browser adapters.                                                      |
| Agent transport was bundled with model orchestration                    | `@vacp/transport-bridge` owns the tool contract and bridge adapter. Agent client owns model and AI SDK behavior.                                      |
| Inspector duplicated bridge types and accepted incomplete objects       | Consumers use the core bridge contract and browser discovery validates all required operations and the protocol version.                              |
| Telemetry read private runtime fields                                   | Runtime/session identity is public metadata.                                                                                                          |
| Inspector mounting offered no disposal                                  | Installation returns a handle that releases its React root and query cache.                                                                           |
| Public documentation mixed setup, architecture, and research operations | Guides live in `docs/`, site machinery in `apps/docs/`, and development material in `development_docs/`.                                              |

The telemetry engine and PostHog provider are separate packages. Telemetry owns subscription lifecycle in a WeakMap rather than writing implementation state onto consumer bridges.

## Retained boundaries

Provider-specific parameter discovery, selection translation, and interaction observers remain with their provider. Database serialization remains with DuckDB. Inspector modules keep their own presentation state and share the protocol bridge. The Python server's browser manager, bridge client, and MCP tool registration remain separate.

Evaluation reports and scoring are application-specific. Their existing runner, analysis, statistics, and rendering modules remain private rather than becoming public packages solely because some files are large. External model execution and remote deployment are separate from deterministic local validation.

## Validation

The runtime suite exercises replay ordering and explicit SQL policy. Browser-package tests exercise structural ports, stable installation identity, discovery, and disposal. The public custom-integration snippet is tested against semantic actions and human input. The full browser suite exercises provider actions, history, Inspector modules, responsive layout, and the built gallery. Workspace builds, declaration checks, Python tests, documentation builds, and workflow linting cover packaging and tooling boundaries.

## Inspector static review

A full React Doctor scan of the Inspector reported 73 warnings (47/100), chiefly existing component complexity, state synchronization, and accessibility suggestions. The changed-file scan does not classify untracked relocated source, so its empty result is not treated as evidence of a clean scan. The scan is supplementary to TypeScript, lint, and interaction tests. No scanner rules were suppressed. Broad UI redesign is separate from the package and ownership changes documented here.

## Type and QA boundaries

Custom action handlers infer parsed parameters and accept domain-interface results. Snapshot providers preserve state and summary types. Protocol action calls, results, nodes, SQL rows, and widget values expose type parameters. AI SDK message metadata and transport wrappers preserve their owner types. The runtime's heterogeneous action registry and external transport payloads retain unvalidated inputs at the boundary. No schema generation is used.

Vite configuration is centralized at the root. Make owns local and CI workflows, including Knip, the anti-slop preset and its upstream tests, and all four Python QA tools. Inspector's diagnostics instrumentation is reference-counted and restores browser methods after the final consumer unmounts.
