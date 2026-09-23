# What is VACP?

VACP gives people and agents one semantic interface to a composed visual analysis. Providers describe their sources, project analytical entities and state, and bind operations to the systems that own those values.

A notebook can contribute an analytical output, a widget can contribute its filter, and a database adapter can contribute a data handle. The composed graph records which source owns each node and action while allowing relationships across sources.

## Observation and control

| Operation           | Result                                                            |
| ------------------- | ----------------------------------------------------------------- |
| `observe()`         | One graph, state, ownership, revision, and freshness observation. |
| `getCapabilities()` | A scoped graph projection.                                        |
| `getState()`        | A scoped state projection or incremental update.                  |
| `execute(call)`     | A semantic action result or structured error.                     |

A **ref** identifies an analytical entity across rerenders and source updates. Nodes can represent views, visualizations, selections, parameters, widgets, data handles, or provider-defined domain concepts. Edges describe relationships such as containment, control, derivation, and visualization.

Actions describe mutations, creations, evaluations, and queries. Their metadata connects input refs, affected entities, dynamic ref parameters, and produced state, data, visualizations, or artifacts.

## Source authority

Each provider publishes an atomic source observation. The provider defines when its values have settled. A Python widget can wait for trait validation and observers. A reactive notebook can report whether an output is stale, running, current, or failed for a given input revision.

Large datasets stay with their owning system. A provider exposes data handles, queries, and bounded summaries while the application retains storage and execution.

## Integrations and consumers

Vega-Lite and VGPlot providers map their visualization runtimes into VACP. Custom providers can bind another visualization, widget system, notebook, or analytical service through the same source, projection, observation, and operation ports.

Custom [inspection surfaces](../inspector/) and [agents](../transports/) consume the composed contract. The [runtime](../reference/runtime) records provenance and owns subscriptions and provider lifecycle. [Provenance consumers](../provenance/) derive checkpoints and restore them through an explicit host capability. The [browser adapter](../reference/browser) exposes the runtime at `window.__vacp` and publishes DOM observations.
