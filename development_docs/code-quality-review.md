# Code quality review

Scope: VACP's protocol, provider composition, runtime, transports, browser installation, Inspector, and examples, plus the local anywidget-mcp and momcp integrations. Package dependencies and large source files were inventoried across all three workspaces. External integrations remain consumers of VACP.

## Findings and changes

| Finding                                                                                                                                                      | Change                                                                                                                                                                                                                                     | Owning boundary            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| URL aliases, environment values, and storage overrides decided which library capabilities were installed.                                                    | Applications pass exposure and SQL options. The Inspector is installed explicitly. Named evaluation contexts live in `examples/config.ts`.                                                                                                 | Application composition    |
| Empty transport reads triggered polling, refreshes, and history changes.                                                                                     | Transports forward settled reads directly, including valid empty observations.                                                                                                                                                             | Provider observation       |
| Freshness-only changes were omitted from subscriptions and historical inspection reused live freshness.                                                      | Publications use observation revisions. History stores its observation, and inspection selects that recorded revision.                                                                                                                     | Runtime                    |
| Replacing one source cancelled unrelated source operations.                                                                                                  | Each provider binding owns its cancellation scope. Queued calls reject replacement of their owner.                                                                                                                                         | Runtime provider lifecycle |
| Graph edges were checked, but operation input and affected references were unchecked.                                                                        | Composition verifies those references against the composed graph. Produced references may describe future entities.                                                                                                                        | Protocol composition       |
| Python and chat filters rejected provider-defined kinds and layers.                                                                                          | Both accept the protocol's open vocabulary. MCP and chat also expose `vacp_observe`.                                                                                                                                                       | Transport contracts        |
| WebMCP imported a concrete runtime type for two capabilities.                                                                                                | Its source port declares capability subscription and lifetime requirements directly.                                                                                                                                                       | WebMCP                     |
| Inspector retained drag and resize listeners after disposal and used a timer-driven closing state machine.                                                   | Listener scopes are disposed with their owner. Panel visibility follows its open state directly.                                                                                                                                           | Inspector lifecycle        |
| Action drafts copied provider defaults into state and required reset effects.                                                                                | Untouched drafts derive from current descriptors. User edits remain local to the action and source session.                                                                                                                                | Inspector action editor    |
| Inspector loaded all module dependencies eagerly.                                                                                                            | Graph, data, actions, history, chat, and JSON load at their module boundaries.                                                                                                                                                             | Inspector shell            |
| Notebook identities used only a filename, inputs were shared across independent evaluations, and parameters were incorrectly labeled as reference arguments. | Paths determine source identities, operations are source-scoped, invocation inputs belong to their output, and operation metadata describes ordinary inputs correctly. Failed evaluations retain the previous result with error freshness. | momcp provider             |
| AnyWidget VACP writes bypassed its model binding and invoked methods reflectively.                                                                           | Native and descriptor bindings implement state application. Native updates use trait notification and comm batching. Disposal is idempotent.                                                                                               | anywidget-mcp model port   |

## Dependency direction

Protocol records have no application, renderer, browser, transport, or host integration imports. Runtime depends on protocol. Transports consume protocol ports. Browser installation and provider adapters compose runtime behavior. Examples install the Inspector. The Inspector consumes those public ports and owns presentation state.

Composition requires one owner per node and action name. Providers reference shared nodes through edges rather than publishing duplicate entities. Standard action names must have one owner in a composed runtime. Source revisions and invalidations define observation consistency. Cross-engine transaction scheduling remains the host's responsibility.

## Presentation

The examples group content through spacing and typography. Gallery cards, chart containers, placeholders, and dashboard panels omit decorative outlines and dividers. Form controls retain visible boundaries and keyboard focus. Vega-Lite and VGPlot share their example shell. The Inspector uses compact navigation and controls, flat surfaces, immediate panel transitions, and keyboard-accessible result copying and column resizing. Graph details appear after selecting an entity and remain accessible on mobile. Graph colors continue to encode analytical relationships.

## Validation boundaries

- `make check`: formatting, lint, package builds, TypeScript, Knip, Python lint and type checks, and unit tests.
- `make e2e`: examples, the published documentation, Inspector interactions and layout, native WebMCP, and runtime lifecycle in Chromium.
- anywidget-mcp: its full check pipeline, including browser integration and the 250,000-row Embedding Atlas scenario.
- momcp: Ruff, ty, Pyrefly, notebook compilation, MCP tools, visual output, source identity, and failed-evaluation freshness tests.
- `agent-browser`: manual gallery, chart, Inspector, and mobile layout checks.

React Doctor is a supplementary heuristic review. Its remaining warnings include component size, editor synchronization effects, virtualized table semantics, and a content fingerprint incorrectly classified as security cryptography. Those warnings are not evidence of a clean bill of health and are assessed against the actual behavior and ownership boundaries.

## Verified results

- VACP: `make check` passed, including 97 Python tests. All 65 browser cases were verified. One dependency scan overlapped a source edit during the full run, and that case passed on a clean `--last-failed` run. Focused replay and graph checks also passed.
- anywidget-mcp: 463 Python tests and 118 browser cases were verified across Chromium, Firefox, and WebKit runs. The Atlas scenario passed in all three engines after using the supported empty label list and keyboard input for its SQL editor.
- momcp: 34 tests and its Ruff, ty, and Pyrefly checks passed.
- Python distribution builds passed for all three repositories. The AnyWidget package also passed wheel-from-sdist and isolated import checks.

Detailed logs and browser captures are retained under `nogit/reviews/code-quality/`.
